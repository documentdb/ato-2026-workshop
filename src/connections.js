import { MongoClient } from "mongodb";
import { WorkshopError } from "./errors.js";

export function createConnections(config) {
  const clients = new Map();
  return {
    db(target) {
      if (!Object.hasOwn(config.targets, target)) {
        throw new WorkshopError(409, "TARGET_NOT_CONFIGURED", "This target is not configured. Select a target configured for this workshop scenario.");
      }
      if (!clients.has(target)) {
        const settings = config.targets[target];
        clients.set(target, new MongoClient(settings.uri, {
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
      return clients.get(target).db(config.targets[target].database);
    },
    async close() {
      await Promise.all([...clients.values()].map((client) => client.close()));
    },
  };
}
