import { MongoClient } from "mongodb";
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
  // WHATWG URL cannot parse valid MongoDB multi-host connection strings.
  if (typeof value !== "string" || !/^mongodb(?:\+srv)?:\/\//.test(value) || value.includes("#")) {
    throw configurationError("CLOUD_DOCUMENTDB_URI must be a valid MongoDB connection URI.");
  }
  // Check every option, including duplicates, before driver normalization.
  for (const [key, optionValue] of new URLSearchParams(value.split("?").slice(1).join("?"))) {
    const option = key.toLowerCase();
    if (
      ["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"].includes(option) ||
      (["tls", "ssl"].includes(option) && optionValue.toLowerCase() !== "true")
    ) {
      throw configurationError("The cloud target must validate TLS certificates and hostnames. Remove insecure TLS options.");
    }
  }
  try {
    // Construction validates without opening a socket or resolving SRV records.
    new MongoClient(value, { tls: true });
  } catch {
    throw configurationError("CLOUD_DOCUMENTDB_URI must be a valid MongoDB connection URI.");
  }
  return value;
}

function developmentTarget(env, siteB = false) {
  const prefix = siteB ? "SITE_B" : "DOCUMENTDB";
  const host = siteB ? (env.SITE_B_DOCUMENTDB_HOST || "documentdb-site-b") : (env.LOCAL_DOCUMENTDB_HOST || "documentdb");
  const allowedHosts = siteB ? ["documentdb-site-b", "localhost", "127.0.0.1"] : ["documentdb", "localhost", "127.0.0.1"];
  if (!allowedHosts.includes(host)) {
    throw configurationError("A development database must use its local Compose service or loopback. Use presenter mode for remote databases.");
  }
  const username = env[`${prefix}_USERNAME`];
  const password = env[`${prefix}_PASSWORD`];
  if (!username || !password) throw configurationError(`${siteB ? "Site B" : "Site A"} credentials are missing. Run the setup command.`);
  return {
    uri: `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:10260/?authMechanism=SCRAM-SHA-256&authSource=admin&directConnection=true`,
    database: databaseName(siteB ? (env.SITE_B_DATABASE_NAME || "ato_workshop") : (env.LOCAL_DATABASE_NAME || "ato_workshop"), siteB ? "SITE_B_DATABASE_NAME" : "LOCAL_DATABASE_NAME"),
    developmentCertificate: true,
  };
}

export function readConfig(env = process.env) {
  const mode = env.WORKSHOP_MODE || "complete";
  const scenario = env.WORKSHOP_SCENARIO || "attendee";
  const location = env.WORKSHOP_LOCATION || "laptop";
  const activeTarget = env.ACTIVE_TARGET || "local";
  if (!["starter", "complete"].includes(mode)) throw configurationError("WORKSHOP_MODE must be starter or complete.");
  if (!["attendee", "presenter"].includes(scenario)) throw configurationError("WORKSHOP_SCENARIO must be attendee or presenter.");
  if (!["laptop", "codespaces"].includes(location)) throw configurationError("WORKSHOP_LOCATION must be laptop or codespaces.");
  if (!["local", "site-b", "cloud"].includes(activeTarget)) throw configurationError("ACTIVE_TARGET must be local, site-b, or cloud.");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw configurationError("PORT must be an integer from 1 through 65535.");
  const publicHost = env.WORKSHOP_PUBLIC_HOST?.trim().toLowerCase() || "";
  if (publicHost && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(publicHost)) {
    throw configurationError("WORKSHOP_PUBLIC_HOST must be one exact hostname, without a scheme, port, or wildcard.");
  }
  const targets = { local: developmentTarget(env) };
  if (scenario === "attendee") {
    targets["site-b"] = developmentTarget(env, true);
    if (env.SITE_B_PASSWORD === env.DOCUMENTDB_PASSWORD) throw configurationError("Site A and Site B must use independently generated passwords. Do not rotate an existing volume's credentials by editing .env.");
    const hostA = env.LOCAL_DOCUMENTDB_HOST || "documentdb";
    const hostB = env.SITE_B_DOCUMENTDB_HOST || "documentdb-site-b";
    if (hostA === hostB || (["localhost", "127.0.0.1"].includes(hostA) && ["localhost", "127.0.0.1"].includes(hostB))) {
      throw configurationError("Site A and Site B must be separate database endpoints, not two databases on one endpoint.");
    }
    // Cloud settings in a legacy .env are deliberately ignored in attendee mode.
  } else {
    const cloudUri = env.CLOUD_DOCUMENTDB_URI?.trim();
    if (cloudUri) {
      targets.cloud = {
        uri: validateCloudUri(cloudUri),
        database: databaseName(env.CLOUD_DATABASE_NAME, "CLOUD_DATABASE_NAME"),
        developmentCertificate: false,
      };
    } else if (env.CLOUD_DATABASE_NAME) {
      throw configurationError("CLOUD_DATABASE_NAME is set but CLOUD_DOCUMENTDB_URI is missing.");
    }
  }
  if (!Object.hasOwn(targets, activeTarget)) throw configurationError("The requested initial database target is not configured for this scenario.");
  return { mode, scenario, location, activeTarget, port, host: env.HOST || "127.0.0.1", publicHost, targets, searchEnabled: env.SEARCH_ENABLED === "1" };
}

export function targetLabel(target, location, scenario = "attendee") {
  if (target === "cloud") return "Azure DocumentDB (presenter)";
  if (scenario === "attendee") return target === "site-b" ? "Site B — self-hosted" : "Site A — self-hosted";
  return location === "codespaces" ? "Development database in Codespaces" : "DocumentDB on this laptop";
}
