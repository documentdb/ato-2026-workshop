import { WorkshopError } from "./errors.js";

function configurationError(message) {
  return new WorkshopError(503, "CONFIGURATION_ERROR", message);
}

function databaseName(value, label) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(value ?? "")) {
    throw configurationError(`${label} must be an explicit database name using letters, digits, underscores, or hyphens.`);
  }
  return value;
}

export function validateCloudUri(value) {
  let uri;
  try {
    uri = new URL(value);
  } catch {
    throw configurationError("CLOUD_DOCUMENTDB_URI must be a valid MongoDB connection URI.");
  }
  if (!["mongodb:", "mongodb+srv:"].includes(uri.protocol) || !uri.hostname || uri.hash) {
    throw configurationError("CLOUD_DOCUMENTDB_URI must use mongodb:// or mongodb+srv://.");
  }
  for (const [key, value] of uri.searchParams) {
    const option = key.toLowerCase();
    if (
      ["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"].includes(option) ||
      (["tls", "ssl"].includes(option) && value.toLowerCase() !== "true")
    ) {
      throw configurationError("The cloud target must validate TLS certificates and hostnames. Remove insecure TLS options.");
    }
  }
  return value;
}

export function readConfig(env = process.env) {
  const mode = env.WORKSHOP_MODE || "complete";
  const location = env.WORKSHOP_LOCATION || "laptop";
  const activeTarget = env.ACTIVE_TARGET || "local";
  if (!["starter", "complete"].includes(mode)) {
    throw configurationError("WORKSHOP_MODE must be starter or complete.");
  }
  if (!["laptop", "codespaces"].includes(location)) {
    throw configurationError("WORKSHOP_LOCATION must be laptop or codespaces.");
  }
  if (!["local", "cloud"].includes(activeTarget)) {
    throw configurationError("ACTIVE_TARGET must be local or cloud.");
  }
  const localHost = env.LOCAL_DOCUMENTDB_HOST || "documentdb";
  if (!["documentdb", "localhost", "127.0.0.1"].includes(localHost)) {
    throw configurationError("The development database must use the local documentdb service or loopback. Use the cloud target for remote databases.");
  }
  if (!env.DOCUMENTDB_USERNAME || !env.DOCUMENTDB_PASSWORD) {
    throw configurationError("Local credentials are missing. Run the setup command before starting the app.");
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configurationError("PORT must be an integer from 1 through 65535.");
  }
  const publicHost = env.WORKSHOP_PUBLIC_HOST?.trim().toLowerCase() || "";
  if (publicHost && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(publicHost)) {
    throw configurationError("WORKSHOP_PUBLIC_HOST must be one exact hostname, without a scheme, port, or wildcard.");
  }
  const localUri = `mongodb://${encodeURIComponent(env.DOCUMENTDB_USERNAME)}:${encodeURIComponent(env.DOCUMENTDB_PASSWORD)}@${localHost}:10260/?authMechanism=SCRAM-SHA-256&authSource=admin&directConnection=true`;
  const cloudUri = env.CLOUD_DOCUMENTDB_URI?.trim();
  const targets = {
    local: {
      uri: localUri,
      database: databaseName(env.LOCAL_DATABASE_NAME || "ato_workshop", "LOCAL_DATABASE_NAME"),
      developmentCertificate: true,
    },
  };
  if (cloudUri) {
    targets.cloud = {
      uri: validateCloudUri(cloudUri),
      database: databaseName(env.CLOUD_DATABASE_NAME, "CLOUD_DATABASE_NAME"),
      developmentCertificate: false,
    };
  } else if (env.CLOUD_DATABASE_NAME) {
    throw configurationError("CLOUD_DATABASE_NAME is set but CLOUD_DOCUMENTDB_URI is missing.");
  }
  if (!targets[activeTarget]) {
    throw configurationError("The requested initial database target is not configured.");
  }
  return { mode, location, activeTarget, port, host: env.HOST || "127.0.0.1", publicHost, targets };
}

export function targetLabel(target, location) {
  return target === "cloud"
    ? "Azure DocumentDB"
    : location === "codespaces"
      ? "Development database in Codespaces"
      : "DocumentDB on this laptop";
}
