// Opt-in host-side probe of exactly the URIs handed to the remote extension.
// No writes, cloud settings, raw errors, credentials, or document contents logged.
import { MongoClient } from "mongodb";
import { readLocalExtensionConnections } from "./extension-connections.mjs";
import { pathToFileURL } from "node:url";

export async function checkExtensionConnections(directory = process.cwd(), log = console.log, Client = MongoClient) {
  const connections = await readLocalExtensionConnections(directory);
  for (const { label, uri, database, port, username, password } of connections) {
    const client = new Client(uri, { auth: { username, password }, tlsAllowInvalidCertificates: true,
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, timeoutMS: 10000 });
    try {
      await client.connect();
      const db = client.db(database);
      await db.command({ ping: 1 });
      const catalog = await db.collection("workshop_meta").findOne({ _id: "catalog", ready: true });
      if (!catalog?.fingerprint) throw new Error("Local catalog not ready");
      const session = await db.collection("sessions").findOne({ catalogVersion: catalog.fingerprint }, { projection: { _id: 1 } });
      if (!session) throw new Error("Local catalog empty");
      // Prove independent authentication at the published endpoint too, not
      // just on the app's Compose network. Only this local counterpart is used.
      const other = connections.find((connection) => connection.port !== port);
      const foreign = new Client(uri, { auth: { username: other.username, password: other.password },
        tlsAllowInvalidCertificates: true, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, timeoutMS: 10000 });
      let rejected = false;
      try { await foreign.connect(); }
      catch (error) { rejected = error.code === 18; }
      finally { await foreign.close(); }
      if (!rejected) throw new Error("Independent local authentication was not verified");
      log(JSON.stringify({ label, port, database, authenticatedCatalogRead: true, foreignCredentialsRejected: true, tls: true, loopbackOnly: true }));
    } catch {
      throw new Error(`${label} probe failed on loopback port ${port}. Check readiness, .env credentials/database and published port; raw driver errors are suppressed. No data changed.`);
    } finally { await client.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkExtensionConnections().catch(() => {
    console.error("Local extension endpoint check failed. Confirm both sites are ready, the .env ports match Compose, and the database/credentials belong to those volumes. Never delete data or change credentials as a generic fix. Raw errors are suppressed.");
    process.exitCode = 1;
  });
}
