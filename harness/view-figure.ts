import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tool, TOOL_ATTACHMENTS_KEY } from "@lloyal-labs/lloyal-agents";
import type { JsonSchema } from "@lloyal-labs/lloyal-agents";

/** e2e only: a tool whose result carries an image, so a tool result rides the
 *  embedding rail on the AGENT's branch (the seed path puts images on the
 *  trunk instead). Figures live in ./fixtures — four labelled PNGs. */
export class ViewFigureTool extends Tool<{ figure: string }> {
  readonly name = "view_figure";
  readonly description =
    "Look at one of the brief's figures (A, B, C or D). Returns the image itself; read the shape, its colour and the code printed under it.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      figure: { type: "string", enum: ["A", "B", "C", "D"], description: "Which figure to look at" },
    },
    required: ["figure"],
  };

  *execute(args: { figure: string }) {
    const id = String(args.figure ?? "").trim().toUpperCase().slice(0, 1);
    if (!["A", "B", "C", "D"].includes(id)) return { error: `no figure ${args.figure}; figures are A, B, C, D` };
    const bytes = readFileSync(join(process.cwd(), "fixtures", `figure-${id}.png`));
    return { figure: id, note: `figure ${id} attached as an image`, [TOOL_ATTACHMENTS_KEY]: [new Uint8Array(bytes)] };
  }
}
