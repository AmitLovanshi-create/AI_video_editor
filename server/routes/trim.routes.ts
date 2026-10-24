
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { FFMPEG_PATH, renderDir } from '../config/paths'
import {
  execFileAsync,
  findUploadedFile,
  getVideoDuration,
} from '../services/video-utils'

const router = Router()

router.post('/', async (req, res) => {
  let outputPath = ''

  try {
    const { videoId, start, end } = req.body ?? {}

    if (
      typeof videoId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(videoId) ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      res.status(400).json({
        error: 'Invalid video ID or trim range.',
      })
      return
    }

    const inputPath = findUploadedFile(videoId)

    if (!inputPath) {
      res.status(404).json({
        error: 'Uploaded video not found. Please upload it again.',
      })
      return
    }

    const duration = await getVideoDuration(inputPath)

    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      start >= duration ||
      end > duration + 0.05
    ) {
      res.status(400).json({
        error: 'Trim range exceeds the video duration.',
        durationSeconds: duration,
      })
      return
    }

    const outputName = `${randomUUID()}.mp4`
    outputPath = path.join(renderDir, outputName)

    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(end - start),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })

    const stats = fs.statSync(outputPath)

    if (stats.size === 0) {
      throw new Error('FFmpeg produced an empty file.')
    }

    res.json({
      message: 'Video trimmed successfully.',
      fileName: outputName,
      durationSeconds: end - start,
      size: stats.size,
      downloadUrl: `/renders/${outputName}`,
    })
  } catch (error) {
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath)
      } catch (cleanupError) {
        console.error(
          'Could not remove incomplete render:',
          cleanupError,
        )
      }
    }

    console.error('Video trimming failed:', error)

    res.status(500).json({
      error: 'Video trimming failed. Check the backend terminal.',
    })
  }
})

export default router
