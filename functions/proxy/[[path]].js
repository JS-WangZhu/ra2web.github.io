/**
 * Free Cloudflare Pages Function reverse proxy for official RA2WEB CDNs.
 * Same-origin /proxy/* paths avoid browser CORS failures on custom domains.
 * Streams upstream bodies (no buffering) and forwards Range / conditional headers.
 */

const UPSTREAMS = {
  res2: "https://res2.wangerhuoda.cn",
  wyhjres2: "https://wyhjres2.bun.sh.cn",
  werhd: "https://werhd.k0s.cn",
  gmap: "https://gmap.wangerhuoda.cn",
  stdres: "https://stdres.wangerhuoda.cn",
  download: "https://download.ra2web.com",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "Range, If-None-Match, If-Modified-Since, Content-Type, Accept, Origin",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function buildUpstreamUrl(requestUrl) {
  const url = new URL(requestUrl);
  const stripped = url.pathname.replace(/^\/proxy\/?/, "");
  const parts = stripped.split("/").filter(Boolean);
  if (!parts.length) return null;

  const prefix = parts[0];
  const base = UPSTREAMS[prefix];
  if (!base) return null;

  const marker = `/proxy/${prefix}`;
  const idx = url.pathname.indexOf(marker);
  let restPath =
    idx >= 0 ? url.pathname.slice(idx + marker.length) : `/${parts.slice(1).join("/")}`;
  if (restPath && !restPath.startsWith("/")) restPath = `/${restPath}`;
  if (restPath === "/") restPath = "";

  return `${base}${restPath}${url.search}`;
}

function filterRequestHeaders(headers) {
  const out = new Headers();
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith("cf-")) continue;
    if (lower === "cookie" || lower === "authorization") continue;
    if (lower === "x-forwarded-for" || lower === "x-forwarded-proto" || lower === "x-real-ip") {
      continue;
    }
    out.set(key, value);
  }
  return out;
}

function filterResponseHeaders(upstreamHeaders) {
  const out = new Headers();
  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith("access-control-")) continue;
    if (lower === "set-cookie") continue;
    out.set(key, value);
  }
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    out.set(key, value);
  }
  return out;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "GET, HEAD, OPTIONS" },
    });
  }

  const upstreamUrl = buildUpstreamUrl(request.url);
  if (!upstreamUrl) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: filterRequestHeaders(request.headers),
      redirect: "follow",
    });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${err?.message || err}`, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: filterResponseHeaders(upstreamResponse.headers),
  });
}
