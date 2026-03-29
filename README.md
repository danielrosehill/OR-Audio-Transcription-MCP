# OR Audio Transcription MCP

An MCP server that transcribes audio files using OpenRouter's audio-capable language models.

## Features

- **Verbatim transcription** — exact word-for-word output including filler words, false starts, and repetitions
- **Cleaned transcription** — lightly edited for readability: removes fillers, adds punctuation, sentence boundaries, and paragraph breaks; omits content not intended for transcription
- **Custom prompt transcription** — direct the transcription with your own prompt for specialized use cases

## Supported Models

| Model | Provider |
|-------|----------|
| `google/gemini-3-flash-preview` (default standard) | Google |
| `google/gemini-3.1-flash-lite-preview` (default budget) | Google |
| `xiaomi/mimo-v2-omni` | Xiaomi |
| `openai/gpt-audio` | OpenAI |
| `openai/gpt-audio-mini` (budget) | OpenAI |
| `mistralai/voxtral-small-24b-2507` | Mistral |
| `openai/gpt-4o-audio-preview` | OpenAI |

## Supported Audio Formats

mp3, wav, ogg, flac, m4a, aac, webm, wma, opus

## Setup

### 1. Get an OpenRouter API key

Sign up at [openrouter.ai](https://openrouter.ai) and create an API key at [openrouter.ai/keys](https://openrouter.ai/keys).

### 2. Install and build

```bash
npm install
npm run build
```

### 3. Configure in Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "audio-transcription": {
      "command": "node",
      "args": ["/path/to/OR-Audio-Transcription-MCP/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Tools

### `transcribe_audio`

Transcribe an audio file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Absolute path to the audio file |
| `mode` | `"verbatim"` \| `"cleaned"` \| `"custom"` | Yes | Transcription mode |
| `custom_prompt` | string | When mode=custom | Custom prompt to direct the transcription |
| `model` | string | No | OpenRouter model ID (defaults to `google/gemini-3-flash-preview`) |
| `budget` | boolean | No | Use budget model (`google/gemini-3.1-flash-lite-preview`). Ignored if `model` is set |

### `list_transcription_models`

Lists all available audio transcription models.

## License

MIT
