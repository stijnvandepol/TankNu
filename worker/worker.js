const BRANDSTOF_API_BASE = "https://www.brandstof-zoeker.nl/ajax/markers";

const rateState = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateState.get(ip);

  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
  }

  if (entry.blockedUntil && now < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    rateState.set(ip, entry);
    return {
      blocked: true,
      retryAfter,
      hardBlock: true,
    };
  }

  entry.timestamps.push(now);

  // Alleen hits van de laatste 1000ms bewaren
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < 1000);

  const count = entry.timestamps.length;

  // Hard block: > 10 pogingen in 1 seconde
  if (count > 10) {
    entry.blockedUntil = now + 60_000;
    rateState.set(ip, entry);
    return {
      blocked: true,
      retryAfter: 60,
      hardBlock: true,
    };
  }

  // Soft limit: > 5 pogingen in 1 seconde
  if (count > 5) {
    rateState.set(ip, entry);
    return {
      blocked: true,
      retryAfter: 1,
      hardBlock: false,
    };
  }

  // Onder de limiet → request toestaan
  rateState.set(ip, entry);
  return {
    blocked: false,
    hardBlock: false,
  };
}


function addCorsHeaders(resp) {
  const newHeaders = new Headers(resp.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "*");
  newHeaders.set("Access-Control-Max-Age", "86400");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: newHeaders,
  });
}

function handleOptions(request) {
  const headers = request.headers;

  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // Alleen GET proxy
    if (request.method !== "GET") {
      return addCorsHeaders(
        new Response(
          JSON.stringify({ error: "Only GET is allowed on this endpoint" }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    }

    // Rate limiting per IP
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";

    const rate = checkRateLimit(ip);
    if (rate.blocked) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            error: "Too many requests",
            detail: rate.hardBlock
              ? "Temporarily blocked due to very high request rate"
              : "Rate limit exceeded, please slow down",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rate.retryAfter),
            },
          },
        ),
      );
    }

    // Exactzelfde pad + query als de Brandstof API
    const upstreamUrl = new URL(BRANDSTOF_API_BASE + url.pathname + url.search);

    // Cache key op basis van volledige upstream URL.
    const cacheKey = new Request(upstreamUrl.toString(), {
      method: "GET",
    });

    const cache = caches.default;

    // Probeer cache
    let response = await cache.match(cacheKey);
    if (response) {
      return addCorsHeaders(response);
    }

    // Upstream fetchen
    response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'nl-NL,nl;q=0.9',
        'Referer': 'https://www.brandstof-zoeker.nl/',
        'Origin': 'https://www.brandstof-zoeker.nl',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      },
      cf: {
        cacheEverything: true,
      },
    });

    // Response clonen
    const respToCache = new Response(response.body, response);
    const headers = new Headers(respToCache.headers);
    headers.set("Cache-Control", "public, max-age=10");

    const cacheableResponse = new Response(respToCache.body, {
      status: respToCache.status,
      statusText: respToCache.statusText,
      headers,
    });

    // In cache zetten
    ctx.waitUntil(cache.put(cacheKey, cacheableResponse.clone()));

    return addCorsHeaders(cacheableResponse);
  },
};