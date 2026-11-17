const configured = new URL(process.env.CONVEX_URL);
const actual = new URL(process.env.AGENTBUS_DEPLOYMENT_URL);
if (configured.origin !== actual.origin) {
  throw new Error(
    "CONVEX_URL does not match the Convex deployment selected by your deploy key. Set the production deployment URL in Vercel.",
  );
}
