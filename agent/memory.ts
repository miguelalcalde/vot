import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";

/**
 * One shared notebook for the whole agent: durable facts about its team,
 * conventions, and what it has learned. Recalled before every turn and edited
 * with memory__save_memory / memory__remove_memory, so it changes without a
 * commit or deploy. Stored in private Vercel Blob on Vercel (in-process during
 * `eve dev`).
 *
 * Shared by every caller. For per-person memory, use `scope: byPrincipal` from
 * "eve/memory/scope" instead.
 */
export default defineMemory({
  description:
    "Your shared notebook: durable facts about your team, their preferences and conventions, and lessons learned. " +
    "Everyone you talk to sees it, so never store secrets or private personal data.",
  provider: fileMemory({ maxCharacters: 8_000 }),
  scope: "agent",
});
