import { defineTool } from "eve/tools";
import { deploymentsInput, listDeployments } from "../lib/self/vercel";

export default defineTool({
  description: "Read recent deployments of your own project, optionally matching an exact committed SHA. READY means deployment readiness, not proof production aliases serve it. No caller sign-in required.",
  inputSchema: deploymentsInput,
  async execute(input) { return listDeployments(input); },
});
