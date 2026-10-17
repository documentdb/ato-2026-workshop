import { MongoClient } from "mongodb";
import { WorkshopError } from "./errors.js";

export function createConnections(config, { Client = MongoClient } = {}) {
  const clients = new Map();
  const pending = new Set();
  let closing = false;
  let closed;
  const assertOpen = () => {
    if (closing) throw new WorkshopError(503, "CONNECTIONS_CLOSED", "The app is shutting down. No new database operation was started.");
  };
  return {
    async db(target) {
      assertOpen();
      if (!Object.hasOwn(config.targets, target)) {
        throw new WorkshopError(409, "TARGET_NOT_CONFIGURED", "This target is not configured. Select a target configured for this workshop scenario.");
      }
      if (!clients.has(target)) {
        const settings = config.targets[target];
        clients.set(target, new Client(settings.uri, {
          appName: "ato-2026-workshop",
          tls: true,
          tlsAllowInvalidCertificates: settings.developmentCertificate,
          tlsAllowInvalidHostnames: false,
          retryWrites: false,
          maxPoolSize: 5,
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
          timeoutMS: 10000,
        }));
      }
      const client = clients.get(target);
      // Explicit connect is required on EVERY acquisition. With driver 7.1, a
      // failed first lazy connection can leave a closed topology behind. The
      // public connect() repairs it and serializes concurrent connection attempts.
      // This reconnects before an operation; it never replays a failed write.
      const connecting = client.connect();
      pending.add(connecting);
      try {
        await connecting;
        assertOpen();
        return client.db(config.targets[target].database);
      } finally {
        pending.delete(connecting);
      }
    },
    close() {
      // Terminal, idempotent shutdown. Drain in-flight acquisitions before closing
      // pools; callers racing with shutdown must not receive a newly opened Db.
      // App shutdown first drains HTTP requests (createApp.close).
      closing = true;
      closed ||= (async () => {
        await Promise.allSettled([...pending]);
        await Promise.all([...clients.values()].map((client) => client.close()));
      })();
      return closed;
    },
  };
}
