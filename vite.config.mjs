import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const realtimeSessionConfig = {
  session: {
    type: "realtime",
    model: "gpt-realtime",
    instructions:
      "You are a DITA XML authoring assistant embedded in an editor. Help users draft, revise, explain schema choices, and reason about references. Keep spoken answers concise.",
    audio: {
      output: {
        voice: "marin",
      },
    },
  },
};

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function openAiDevMiddleware() {
  return {
    name: "xml-editor-openai-api",
    configureServer(server) {
      server.middlewares.use("/api/realtime/client-secret", async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
          res.statusCode = 501;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "OPENAI_API_KEY is not configured for this dev server.",
          }));
          return;
        }

        try {
          const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(realtimeSessionConfig),
          });

          const body = await response.text();
          res.statusCode = response.status;
          res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/json");
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to create Realtime client secret." }));
        }
      });

      server.middlewares.use("/api/chat", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
          res.statusCode = 501;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "OPENAI_API_KEY is not configured for this dev server.",
          }));
          return;
        }

        try {
          const body = await readJsonBody(req);
          const prompt = String(body.prompt || "").trim();
          const context = body.context || {};

          if (!prompt) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Prompt is required." }));
            return;
          }

          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              instructions:
                "You are a professional DITA XML authoring assistant embedded in an XML editor. Help users write, revise, explain, and validate documentation. Be concise and practical.",
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: `Editor context: ${JSON.stringify(context)}\n\nUser request: ${prompt}`,
                    },
                  ],
                },
              ],
            }),
          });

          const responseBody = await response.json();

          if (!response.ok) {
            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              error: responseBody.error?.message || "OpenAI chat request failed.",
            }));
            return;
          }

          const text = responseBody.output_text ||
            responseBody.output?.flatMap((item) => item.content || [])
              .map((content) => content.text || "")
              .filter(Boolean)
              .join("\n")
              .trim() ||
            "I could not produce a response.";

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ text }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to send chat request." }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), openAiDevMiddleware()],
  server: {
    watch: {
      ignored: [
        "**/backend/**",
        "**/dist/**",
        "**/tools/**",
        "**/node_modules/**",
      ],
    },
  },
});
