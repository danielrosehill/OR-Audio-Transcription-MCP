#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SUPPORTED_MODELS = [
  "xiaomi/mimo-v2-omni",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3-flash-preview",
  "openai/gpt-audio",
  "openai/gpt-audio-mini",
  "mistralai/voxtral-small-24b-2507",
  "openai/gpt-4o-audio-preview",
] as const;

const DEFAULT_STANDARD_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_BUDGET_MODEL = "google/gemini-3.1-flash-lite-preview";

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".wma": "audio/x-ms-wma",
  ".opus": "audio/opus",
};

const VERBATIM_PROMPT = `Transcribe this audio file verbatim. Include every word exactly as spoken, including filler words (um, uh, like, you know), false starts, repetitions, and stutters. Do not add punctuation that wasn't clearly indicated by the speaker's pauses. Do not clean up grammar or word choice. Output only the transcription text with no preamble or commentary.`;

const CLEANED_PROMPT = `Transcribe this audio file into clean, readable text. Apply the following cleanup rules:
- Remove filler words (um, uh, like, you know, basically, literally, etc.)
- Remove false starts, stutters, and repeated words
- Add proper punctuation (periods, commas, question marks, etc.)
- Add sentence boundaries and paragraph breaks where the topic or thought shifts
- Fix obvious grammatical errors that are clearly speech artifacts (not intentional dialect/style)
- Omit any content that was clearly not intended to be part of the transcription (background conversations, asides to others in the room, self-corrections like "no wait, scratch that")
- Preserve the speaker's meaning, tone, and intent faithfully
Output only the cleaned transcription text with no preamble or commentary.`;

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY environment variable is required. " +
        "Get your API key from https://openrouter.ai/keys"
    );
  }
  return key;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = AUDIO_MIME_TYPES[ext];
  if (!mime) {
    throw new Error(
      `Unsupported audio format: ${ext}. Supported formats: ${Object.keys(AUDIO_MIME_TYPES).join(", ")}`
    );
  }
  return mime;
}

function readAudioAsBase64(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Audio file not found: ${resolved}`);
  }
  const stats = fs.statSync(resolved);
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (stats.size > maxSize) {
    throw new Error(
      `Audio file too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 100MB.`
    );
  }
  return fs.readFileSync(resolved).toString("base64");
}

async function transcribeAudio(
  filePath: string,
  systemPrompt: string,
  model: string
): Promise<string> {
  const apiKey = getApiKey();
  const mimeType = getMimeType(filePath);
  const audioBase64 = readAudioAsBase64(filePath);
  const body = {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: systemPrompt,
          },
          {
            type: "input_audio" as const,
            input_audio: {
              data: audioBase64,
              format: mimeType === "audio/wav" ? "wav" : "mp3",
            },
          },
        ],
      },
    ],
  };

  // Some models prefer the URL-based format over input_audio
  const urlBody = {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: systemPrompt,
          },
          {
            type: "audio_url" as const,
            audio_url: {
              url: `data:${mimeType};base64,${audioBase64}`,
            },
          },
        ],
      },
    ],
  };

  // Try input_audio format first, fall back to audio_url format
  for (const requestBody of [body, urlBody]) {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/danielrosehill/OR-Audio-Transcription-MCP",
        "X-Title": "OR Audio Transcription MCP",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (data.error) {
        // If this format produced an error, try the next one
        continue;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("No transcription content in API response");
      }
      return content;
    }

    // If we get a 4xx error that suggests format issue, try next format
    if (response.status >= 400 && response.status < 500) {
      continue;
    }

    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  throw new Error(
    "Failed to transcribe audio with both input formats. The selected model may not support audio input."
  );
}

const server = new McpServer({
  name: "or-audio-transcription",
  version: "1.0.0",
});

server.tool(
  "transcribe_audio",
  "Transcribe an audio file using OpenRouter. Supports verbatim, cleaned, or custom prompt modes.",
  {
    file_path: z
      .string()
      .describe(
        "Absolute path to the audio file to transcribe. Supported formats: mp3, wav, ogg, flac, m4a, aac, webm, wma, opus"
      ),
    mode: z
      .enum(["verbatim", "cleaned", "custom"])
      .describe(
        "Transcription mode. 'verbatim': exact word-for-word transcription including filler words. " +
          "'cleaned': lightly edited for readability (removes fillers, adds punctuation, paragraph breaks). " +
          "'custom': use a custom prompt to direct the transcription."
      ),
    custom_prompt: z
      .string()
      .optional()
      .describe(
        "Custom prompt to direct the transcription (required when mode is 'custom'). " +
          "This replaces the default system prompt entirely."
      ),
    model: z
      .string()
      .optional()
      .describe(
        `OpenRouter model to use for transcription. Defaults to '${DEFAULT_STANDARD_MODEL}'. ` +
          `Available models: ${SUPPORTED_MODELS.join(", ")}`
      ),
    budget: z
      .boolean()
      .optional()
      .describe(
        "Use the default budget model instead of the standard model. " +
          `Budget model: '${DEFAULT_BUDGET_MODEL}'. Ignored if 'model' is explicitly set.`
      ),
  },
  async ({ file_path, mode, custom_prompt, model, budget }) => {
    const selectedModel = model || (budget ? DEFAULT_BUDGET_MODEL : DEFAULT_STANDARD_MODEL);

    let prompt: string;
    switch (mode) {
      case "verbatim":
        prompt = VERBATIM_PROMPT;
        break;
      case "cleaned":
        prompt = CLEANED_PROMPT;
        break;
      case "custom":
        if (!custom_prompt) {
          return {
            content: [
              {
                type: "text",
                text: "Error: custom_prompt is required when mode is 'custom'",
              },
            ],
            isError: true,
          };
        }
        prompt = custom_prompt;
        break;
    }

    try {
      const transcription = await transcribeAudio(file_path, prompt, selectedModel);
      return {
        content: [
          {
            type: "text",
            text: transcription,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Transcription failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_transcription_models",
  "List available OpenRouter models that support audio transcription.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text:
            `Available audio transcription models:\n\n` +
            SUPPORTED_MODELS.map(
              (m) => {
                if (m === DEFAULT_STANDARD_MODEL) return `- ${m} (default standard)`;
                if (m === DEFAULT_BUDGET_MODEL) return `- ${m} (default budget)`;
                return `- ${m}`;
              }
            ).join("\n") +
            `\n\nAll models accept audio input and produce text output via OpenRouter.`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OR Audio Transcription MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
