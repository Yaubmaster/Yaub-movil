// yaubmovil.mx en Cloudflare Workers (SCRUM-75). Ver wrangler.jsonc.
// www.yaubmovil.mx → yaubmovil.mx (mismo camino y query); todo lo demás se sirve de los archivos estáticos.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.yaubmovil.mx") {
      url.hostname = "yaubmovil.mx";
      return Response.redirect(url.toString(), 308);
    }
    return env.ASSETS.fetch(request);
  },
};
