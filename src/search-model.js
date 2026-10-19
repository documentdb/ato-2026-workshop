import { WorkshopError } from "./errors.js";

// Fixed internal Compose service only: never accept a request-supplied model URL.
export const MODEL_URL = "http://search-model:11434";
export const SEARCH_MODEL = Object.freeze({
  name: "nomic-embed-text:v1.5",
  digest: "0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f",
  dimensions: 768,
});
export const MODEL_MAX_BYTES = 400_000_000;
export const MODEL_BATCH = 4;

export function checkedVector(vector) {
  if (!Array.isArray(vector) || vector.length !== SEARCH_MODEL.dimensions ||
      Array.from(vector).some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new WorkshopError(503, "SEARCH_VECTOR_INVALID", "Search requires finite 768-dimensional embeddings. No keyword fallback was used.");
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  if (Math.abs(norm - 1) > 0.01) {
    throw new WorkshopError(503, "SEARCH_VECTOR_INVALID", "The embedding is not unit normalized. Search was not executed.");
  }
  return vector;
}

export class SearchModel {
  constructor({ fetchImpl = fetch, url = MODEL_URL } = {}) {
    if (url !== MODEL_URL) throw new WorkshopError(503, "SEARCH_CONFIGURATION", "Only the fixed internal search-model service is supported.");
    this.fetchImpl = fetchImpl;
    this.busy = false;
  }

  async call(path, body, { signal, timeoutMs = 5000 } = {}) {
    if (!["/api/tags", "/api/embeddings"].includes(path)) throw new Error("Unsupported search model operation.");
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.fetchImpl(`${MODEL_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new WorkshopError(503, "SEARCH_MODEL_UNAVAILABLE", "The local embedding service rejected the request. Retry after checking search readiness; no fallback was used.");
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 256_000) throw new WorkshopError(503, "SEARCH_MODEL_INVALID", "The embedding service returned an oversized response.");
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!result || typeof result !== "object" || result.error) throw new Error("Invalid model response");
      return result;
    } catch (error) {
      if (signal?.aborted) throw new WorkshopError(499, "SEARCH_CANCELLED", "Search was cancelled.");
      if (timeout.aborted) throw new WorkshopError(504, "SEARCH_MODEL_TIMEOUT", "Local embedding timed out. Try again after the model finishes loading; no fallback was used.");
      if (error instanceof WorkshopError) throw error;
      throw new WorkshopError(503, "SEARCH_MODEL_UNAVAILABLE", "The optional local embedding service is unavailable. Run the explicit search preparation command; keyword browsing is separate.");
    }
  }

  async verify(signal) {
    const data = await this.call("/api/tags", undefined, { signal });
    const model = data.models?.find((item) => item.name === SEARCH_MODEL.name);
    if (!model || model.digest?.replace(/^sha256:/, "") !== SEARCH_MODEL.digest ||
        !Number.isFinite(model.size) || model.size <= 0 || model.size > MODEL_MAX_BYTES) {
      throw new WorkshopError(503, "SEARCH_MODEL_MISMATCH", "The pinned embedding model is missing or has changed. Run search:prepare; no other model or keyword fallback was used.");
    }
    return SEARCH_MODEL;
  }

  async embed(texts, signal) {
    if (!Array.isArray(texts) || !texts.length || texts.length > MODEL_BATCH ||
        Array.from(texts).some((text) => typeof text !== "string" || text.length > 3000 || !/^(search_query|search_document): /.test(text))) {
      throw new WorkshopError(400, "SEARCH_EMBED_INPUT", "Embedding input is outside the bounded search contract.");
    }
    if (this.busy) throw new WorkshopError(429, "SEARCH_BUSY", "One search is already running. Wait or cancel it before retrying.");
    this.busy = true;
    try {
      await this.verify(signal);
      const vectors = [];
      // The bounded pinned runtime exposes the single-prompt embeddings API.
      // Sequential calls avoid an unbounded runtime queue. No generation API exists here.
      for (const prompt of texts) {
        const data = await this.call("/api/embeddings", {
          model: SEARCH_MODEL.name, prompt, keep_alive: "2m",
          options: { num_thread: 2, num_ctx: 2048, num_gpu: 0 },
        }, { signal, timeoutMs: 60000 });
        const raw = data.embedding;
        if (!Array.isArray(raw) || raw.length !== SEARCH_MODEL.dimensions || Array.from(raw).some((n) => typeof n !== "number" || !Number.isFinite(n))) {
          throw new WorkshopError(503, "SEARCH_VECTOR_INVALID", "The model returned an unexpected embedding shape.");
        }
        const norm = Math.sqrt(raw.reduce((sum, n) => sum + n * n, 0));
        if (!Number.isFinite(norm) || norm <= 0) throw new WorkshopError(503, "SEARCH_VECTOR_INVALID", "The model returned a zero or invalid embedding.");
        vectors.push(checkedVector(raw.map((n) => n / norm)));
      }
      return vectors;
    } finally {
      this.busy = false;
    }
  }
}
