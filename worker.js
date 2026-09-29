const TNEB_URL =
    "https://www.tnebltd.gov.in/outages/viewshutdown.xhtml";

const CAPTCHA_URL =
    "https://www.tnebltd.gov.in/outages/captcha.jpg?pfdrid_c=true";

const SESSION_TTL = 10 * 60; // 10 minutes


export default {
    async fetch(request, env) {

        const url = new URL(request.url);

        // -----------------------------
        // CORS
        // -----------------------------

        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders()
            });
        }

        try {

            // -----------------------------
            // CREATE SESSION
            // -----------------------------

            if (
                url.pathname === "/api/session" &&
                request.method === "GET"
            ) {
                return await createSession(env);
            }


            // -----------------------------
            // CAPTCHA
            // -----------------------------

            if (
                url.pathname === "/api/captcha" &&
                request.method === "GET"
            ) {
                return await getCaptcha(request, env);
            }


            // -----------------------------
            // SHUTDOWN
            // -----------------------------

            if (
                url.pathname === "/api/shutdown" &&
                request.method === "POST"
            ) {
                return await submitShutdown(request, env);
            }


            // -----------------------------
            // SERVE HTML
            // -----------------------------

            if (url.pathname === "/" || url.pathname === "/index.html") {

                return env.ASSETS.fetch(request);

            }


            return json({
                success: false,
                error: "Not found"
            }, 404);

        } catch (error) {

            console.error(error);

            return json({
                success: false,
                error: error.message || "Server error"
            }, 500);
        }
    }
};


// ============================================================
// CREATE TNPDCL SESSION
// ============================================================

async function createSession(env) {

    const response = await fetch(TNEB_URL, {
        method: "GET",
        redirect: "follow",

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

            "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
    });


    if (!response.ok) {

        throw new Error(
            `TNPDCL returned HTTP ${response.status}`
        );

    }


    const html = await response.text();


    // Get session cookie
    const cookieHeader =
        getSetCookieHeader(response.headers);


    if (!cookieHeader) {

        throw new Error(
            "TNPDCL did not provide a session cookie."
        );

    }


    // Extract JSF ViewState
    const viewState =
        extractViewState(html);


    if (!viewState) {

        throw new Error(
            "javax.faces.ViewState was not found."
        );

    }


    // Generate our own browser session ID
    const clientSession =
        crypto.randomUUID();


    const sessionData = {

        cookie: cookieHeader,

        viewState: viewState,

        created: Date.now()

    };


    await env.SESSIONS.put(
        clientSession,
        JSON.stringify(sessionData),
        {
            expirationTtl: SESSION_TTL
        }
    );


    return json({

        success: true,

        session: clientSession,

        expiresIn: SESSION_TTL

    });

}


// ============================================================
// GET CAPTCHA
// ============================================================

async function getCaptcha(request, env) {

    const url = new URL(request.url);

    const sessionId =
        url.searchParams.get("session");


    if (!sessionId) {

        return json({
            success: false,
            error: "Missing session"
        }, 400);

    }


    const session =
        await getSession(env, sessionId);


    if (!session) {

        return json({
            success: false,
            error: "Session expired. Create a new session."
        }, 401);

    }


    const response = await fetch(
        CAPTCHA_URL,
        {
            method: "GET",

            headers: {

                "Cookie": session.cookie,

                "Referer": TNEB_URL,

                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

                "Accept":
                    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"

            }
        }
    );


    if (!response.ok) {

        throw new Error(
            `CAPTCHA request failed: HTTP ${response.status}`
        );

    }


    const image =
        await response.arrayBuffer();


    return new Response(image, {

        status: 200,

        headers: {

            "Content-Type":
                response.headers.get("content-type") ||
                "image/jpeg",

            "Cache-Control":
                "no-store, no-cache, must-revalidate",

            "Pragma": "no-cache",

            ...corsHeaders()

        }

    });

}


// ============================================================
// SUBMIT SHUTDOWN FORM
// ============================================================

async function submitShutdown(request, env) {

    const body =
        await request.json();


    const sessionId =
        body.session;


    const circle =
        body.circle;


    const captcha =
        body.captcha;


    if (!sessionId) {

        return json({
            success: false,
            error: "Missing session"
        }, 400);

    }


    if (!circle) {

        return json({
            success: false,
            error: "Circle is required"
        }, 400);

    }


    if (!captcha) {

        return json({
            success: false,
            error: "CAPTCHA is required"
        }, 400);

    }


    const session =
        await getSession(env, sessionId);


    if (!session) {

        return json({
            success: false,
            error: "Session expired. Refresh and try again."
        }, 401);

    }


    // JSF multipart form
    const form =
        new FormData();


    form.append(
        "j_idt6",
        "j_idt6"
    );


    form.append(
        "j_idt6:appcat_input",
        circle
    );


    form.append(
        "j_idt6:cap",
        captcha
    );


    form.append(
        "j_idt6:submit3",
        "j_idt6:submit3"
    );


    form.append(
        "javax.faces.ViewState",
        session.viewState
    );


    const response = await fetch(
        TNEB_URL,
        {

            method: "POST",

            redirect: "follow",

            headers: {

                "Cookie":
                    session.cookie,

                "Origin":
                    "https://www.tnebltd.gov.in",

                "Referer":
                    TNEB_URL,

                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

                "Accept":
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

            },

            body: form

        }
    );


    const html =
        await response.text();


    if (!response.ok) {

        throw new Error(
            `TNPDCL returned HTTP ${response.status}`
        );

    }


    // Detect CAPTCHA error
    const captchaFailed =
        /invalid.*captcha|captcha.*invalid|wrong.*captcha/i
            .test(html);


    if (captchaFailed) {

        return json({

            success: false,

            captchaError: true,

            error:
                "Incorrect CAPTCHA. Please refresh the CAPTCHA and try again."

        });

    }


    // Parse shutdown information
    const shutdowns =
        parseShutdowns(html);


    return json({

        success: true,

        circle: circle,

        count: shutdowns.length,

        shutdowns: shutdowns,

        rawAvailable: true

    });

}


// ============================================================
// SESSION HELPERS
// ============================================================

async function getSession(env, id) {

    const value =
        await env.SESSIONS.get(id);


    if (!value) {
        return null;
    }


    return JSON.parse(value);

}


// ============================================================
// EXTRACT VIEWSTATE
// ============================================================

function extractViewState(html) {

    const regex =
        /name=["']javax\.faces\.ViewState["'][^>]*value=["']([^"']+)["']/i;


    const match =
        html.match(regex);


    if (match) {
        return decodeHtml(match[1]);
    }


    // Try reversed attribute order
    const regex2 =
        /value=["']([^"']+)["'][^>]*name=["']javax\.faces\.ViewState["']/i;


    const match2 =
        html.match(regex2);


    if (match2) {
        return decodeHtml(match2[1]);
    }


    return null;

}


// ============================================================
// PARSE SHUTDOWN RESULTS
// ============================================================

function parseShutdowns(html) {

    const results = [];


    /*
       TNPDCL may change its HTML structure.

       First try tables.
    */


    const tableRegex =
        /<table[\s\S]*?<\/table>/gi;


    const tables =
        html.match(tableRegex) || [];


    for (const table of tables) {

        const rows =
            table.match(/<tr[\s\S]*?<\/tr>/gi) || [];


        for (const row of rows) {

            const cells =
                row.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];


            if (!cells.length) {
                continue;
            }


            const values =
                cells.map(cell =>
                    cleanHtml(cell)
                );


            if (
                values.length >= 2 &&
                values.some(v =>
                    /shutdown|outage|area|time|from|to/i.test(v)
                )
            ) {

                results.push({

                    values: values

                });

            }

        }

    }


    /*
       If table parser didn't find anything,
       extract visible text as fallback.
    */

    if (!results.length) {

        const text =
            cleanHtml(html);


        const lines =
            text
                .split("\n")
                .map(x => x.trim())
                .filter(Boolean);


        for (const line of lines) {

            if (
                /shutdown|outage|power cut|maintenance/i
                    .test(line)
            ) {

                results.push({

                    text: line

                });

            }

        }

    }


    return results;

}


// ============================================================
// HTML CLEANER
// ============================================================

function cleanHtml(html) {

    return decodeHtml(
        html

            .replace(/<script[\s\S]*?<\/script>/gi, "")

            .replace(/<style[\s\S]*?<\/style>/gi, "")

            .replace(/<[^>]+>/g, " ")

            .replace(/\s+/g, " ")

            .trim()
    );

}


// ============================================================
// HTML ENTITY DECODER
// ============================================================

function decodeHtml(value) {

    return value

        .replace(/&amp;/g, "&")

        .replace(/&lt;/g, "<")

        .replace(/&gt;/g, ">")

        .replace(/&quot;/g, '"')

        .replace(/&#39;/g, "'");

}


// ============================================================
// COOKIE
// ============================================================

function getSetCookieHeader(headers) {

    /*
       Cloudflare Workers normally expose Set-Cookie
       through getSetCookie() when available.
    */

    if (
        typeof headers.getSetCookie === "function"
    ) {

        const cookies =
            headers.getSetCookie();


        if (cookies?.length) {

            return cookies
                .map(cookie =>
                    cookie.split(";")[0]
                )
                .join("; ");

        }

    }


    const cookie =
        headers.get("set-cookie");


    if (!cookie) {
        return null;
    }


    return cookie
        .split(/,(?=[^;]+?=)/)
        .map(x =>
            x.split(";")[0]
        )
        .join("; ");

}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {

    return new Response(
        JSON.stringify(data),
        {

            status,

            headers: {

                "Content-Type":
                    "application/json;charset=UTF-8",

                ...corsHeaders()

            }

        }
    );

}


// ============================================================
// CORS
// ============================================================

function corsHeaders() {

    return {

        "Access-Control-Allow-Origin":
            "*",

        "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type"

    };

}
