import { defineDynamic, defineInstructions } from "eve/instructions";
import { renderSetup } from "../lib/self/setup";

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => defineInstructions({
      role: "system",
      content: renderSetup(process.env, ctx.channel.kind),
    }),
  },
});
