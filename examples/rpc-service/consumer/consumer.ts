/**
 * Consumer Worker — calls PaletaService via a Service Binding (RPC).
 *
 * In wrangler.jsonc:
 *   [[services]]
 *   binding = "PALETA"
 *   service = "paleta-service"
 *   entrypoint = "PaletaService"
 *
 * Calls are zero-cost vs an HTTP subrequest: same thread, no serialization
 * over the wire, no billed requests between caller and service.
 */

import type PaletaService from "../service/service.js";

interface Env {
  PALETA: Service<PaletaService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get("url");
    if (!imageUrl) {
      return new Response("pass ?url=<image-url>", { status: 400 });
    }

    const bg = url.searchParams.get("bg") ?? "#000000";
    const result = await env.PALETA.accent(imageUrl, bg);

    return Response.json(result, {
      headers: { "cache-control": "public, max-age=300" },
    });
  },
} satisfies ExportedHandler<Env>;
