import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

/**
 * Your own deployment: projects, deployments, build and runtime logs, and docs,
 * through Vercel's MCP server. Authorize it for the team that owns this project.
 */
export default defineMcpClientConnection({
  url: "https://mcp.vercel.com",
  description:
    "Vercel: check your own deployments and build status, read build and runtime logs, and search Vercel docs.",
  auth: connect({
    connector: "vercel",
    instructions:
      "Authorize Vercel in your browser. Select the team that owns this agent's project, then grant access to " +
      "its projects and deployments. Tools fail with a permission error for anything left unselected.",
  }),
});
