import { GoogleGenAI } from '@google/genai'
import { editPlanSchema } from '../schemas/edit-plan.schema'

const apiKey = process.env.GEMINI_API_KEY

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is missing from server environment.')
}

const ai = new GoogleGenAI({ apiKey })

type VideoInput = {
  videoId: string
  durationSeconds: number
  width: number | null
  height: number | null
  hasAudio: boolean
}

export async function generateEditPlan(instruction: string, videos: VideoInput[]) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `You are FrameFlow, an AI video editing planner.
Create a concrete edit plan for the user's request using ONLY the supplied videos.

Return only JSON matching this structure:
{
  "goal": "original user request, concise",
  "clips": [
    {
      "videoId": "one supplied video ID",
      "start": 0,
      "end": 5,
      "effects": ["grayscale"],
      "transitionIn": "none"
    }
  ],
  "audio": {
    "mode": "keep_original",
    "volume": 1
  },
  "captions": {
    "enabled": false,
    "text": "",
    "position": "bottom"
  },
  "output": {
    "format": "mp4",
    "resolution": "720p",
    "fps": 30
  }
}

Supported visual effects (use only these exact names):
- grayscale: black-and-white / monochrome
- warm: warm color tone
- cool: cool color tone
- vintage: mild vintage color tone
- brighten: increase brightness
- contrast: increase contrast
- none: no visual effect

Supported transitions (use only these exact names):
- none
- fade

Supported audio modes:
- keep_original
- mute

Rules:
- Use only video IDs from the supplied metadata.
- Each clip start must be >= 0; end must be > start and <= that video's duration.
- Use 1 to 20 clips.
- Do not invent music files or claim you can remove speech/noise unless explicitly supported.
- If the user asks for captions but supplies no transcript, use captions.enabled=false and explain the limitation in goal; do not invent spoken words.
- For requests that need unsupported operations (object removal, generative scene changes, face retouching, arbitrary background replacement, precise subject tracking, adding external music), do not pretend they are implemented. Use the closest supported operations only and mention the limitation in goal.
- Prefer the requested effect over generic editing. For "black and white", include "grayscale" in each selected clip's effects.
- If no clip order is specified, use the provided order.
- Keep audio mode keep_original unless user explicitly asks to mute.
- Resolution must be 720p or 1080p. Use 720p if not specified.
- fps must be 24, 25, or 30; use 30 unless the user specifies a supported alternative.
- transitionIn is the transition from the previous clip; use none for the first clip.
- Return valid JSON only, with no markdown fences.

USER REQUEST:
${instruction}

AVAILABLE VIDEOS:
${JSON.stringify(videos)}
`,
      }],
    }],
    config: {
      responseMimeType: 'application/json',
    },
  })

  const responseText = response.text
  if (!responseText) {
    throw new Error('Gemini returned an empty response.')
  }

  const parsed: unknown = JSON.parse(responseText)
  return editPlanSchema.parse(parsed)
}
