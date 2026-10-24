
import { z } from 'zod'

import { FFPROBE_PATH } from '../config/paths'
import {
  execFileAsync,
  findUploadedFile,
} from '../services/video-utils'

const videoIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}$/i, 'Invalid video ID')

export type VideoMetadata = {
  videoId: string
  durationSeconds: number
  width: number | null
  height: number | null
  hasAudio: boolean
}

export async function getUploadedVideoMetadata(
  videoId: string,
): Promise<VideoMetadata> {
  const validatedId = videoIdSchema.parse(videoId)
  const inputPath = findUploadedFile(validatedId)

  if (!inputPath) {
    throw new Error('Uploaded video not found. Please upload it again.')
  }

  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    inputPath,
  ])

  const metadata = JSON.parse(stdout)

  const streams: Array<{
    codec_type?: string
    width?: number
    height?: number
  }> = metadata.streams ?? []

  const videoStream = streams.find(
    (stream) => stream.codec_type === 'video',
  )

  if (!videoStream) {
    throw new Error('The uploaded file does not contain a valid video stream.')
  }

  const durationSeconds = Number(metadata.format?.duration ?? 0)

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine the video duration.')
  }

  return {
    videoId: validatedId,
    durationSeconds,
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    hasAudio: streams.some(
      (stream) => stream.codec_type === 'audio',
    ),
  }
}
