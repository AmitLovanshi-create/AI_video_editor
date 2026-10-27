import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FFMPEG_PATH, renderDir } from '../config/paths'
import { editPlanSchema } from '../schemas/edit-plan.schema'
import { execFileAsync, findUploadedFile, getVideoDuration } from '../services/video-utils'

const router = Router()

function videoFilters(effects: string[], resolution: '720p' | '1080p', fps: 24 | 25 | 30) {
  const size = resolution === '1080p' ? '1920:1080' : '1280:720'
  const filters = [
    `scale=${size}:force_original_aspect_ratio=decrease`,
    `pad=${size}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${fps}`,
    'setsar=1',
  ]

  for (const effect of effects) {
    switch (effect) {
      case 'none': break
      case 'grayscale': filters.push('hue=s=0'); break
      case 'warm': filters.push('colorbalance=rs=0.08:gs=0.02:bs=-0.06'); break
      case 'cool': filters.push('colorbalance=rs=-0.05:gs=0.01:bs=0.08'); break
      case 'vintage':
        filters.push('eq=saturation=0.75:contrast=1.08:brightness=0.02', 'colorbalance=rs=0.05:bs=-0.04')
        break
      case 'brighten': filters.push('eq=brightness=0.08'); break
      case 'contrast': filters.push('eq=contrast=1.2'); break
    }
  }
  return filters
}

router.post('/', async (req, res) => {
  const temporaryPaths: string[] = []
  let outputPath = ''

  try {
    const plan = editPlanSchema.parse(req.body?.editPlan)

    // Critical behavior: fail before rendering when the planner admits unsupported work.
    if (plan.unsupportedRequests.length > 0) {
      res.status(422).json({
        success: false,
        code: 'UNSUPPORTED_OPERATIONS',
        message: 'This edit includes operations FrameFlow cannot execute yet.',
        unsupportedRequests: plan.unsupportedRequests,
        supportedCapabilities: {
          effects: ['none', 'grayscale', 'warm', 'cool', 'vintage', 'brighten', 'contrast'],
          transitions: ['none', 'fade (fade-in only)'],
          audio: ['keep_original', 'mute'],
        },
      })
      return
    }

    const segmentPaths: string[] = []

    for (let index = 0; index < plan.clips.length; index += 1) {
      const clip = plan.clips[index]
      const inputPath = findUploadedFile(clip.videoId)
      if (!inputPath) throw new Error(`Uploaded video not found: ${clip.videoId}`)

      const duration = await getVideoDuration(inputPath)
      if (!Number.isFinite(duration) || clip.start < 0 || clip.end <= clip.start || clip.end > duration + 0.05) {
        throw new Error(`Invalid trim range for video ${clip.videoId}`)
      }

      const segmentPath = path.join(renderDir, `${randomUUID()}-segment.ts`)
      segmentPaths.push(segmentPath)
      temporaryPaths.push(segmentPath)

      const filters = videoFilters(clip.effects, plan.output.resolution, plan.output.fps)
      if (clip.transitionIn === 'fade') {
        filters.push('fade=t=in:st=0:d=0.5')
}

      const args = [
        '-y', '-ss', String(clip.start), '-i', inputPath,
        '-t', String(clip.end - clip.start),
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', filters.join(','),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      ]

      if (plan.audio.mode === 'mute') {
        args.push('-an')
      } else {
        args.push('-af', `volume=${plan.audio.volume}`, '-c:a', 'aac', '-ar', '44100', '-ac', '2')
      }

      args.push('-avoid_negative_ts', 'make_zero', '-f', 'mpegts', segmentPath)
      await execFileAsync(FFMPEG_PATH, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })
    }

    outputPath = path.join(renderDir, `${randomUUID()}.mp4`)
    await execFileAsync(FFMPEG_PATH, [
      '-y', '-i', `concat:${segmentPaths.join('|')}`,
      '-c', 'copy', '-movflags', '+faststart', outputPath,
    ], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })

    const stats = fs.statSync(outputPath)
    if (stats.size <= 0) throw new Error('FFmpeg produced an empty video.')

    res.json({
      success: true,
      message: 'Edit plan rendered successfully.',
      fileName: path.basename(outputPath),
      downloadUrl: `/renders/${path.basename(outputPath)}`,
      size: stats.size,
      clipCount: plan.clips.length,
      resolution: plan.output.resolution,
      fps: plan.output.fps,
      effectsApplied: [...new Set(plan.clips.flatMap((clip) => clip.effects).filter((effect) => effect !== 'none'))],
      transitionsApplied: [...new Set(plan.clips.map((clip) => clip.transitionIn).filter((transition) => transition !== 'none'))],
      audioMode: plan.audio.mode,
      notices: [],
    })
  } catch (error) {
    console.error('Video rendering failed:', error)
    if (outputPath && fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath) } catch (cleanupError) {
        console.error('Could not remove incomplete render:', cleanupError)
      }
    }
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Video rendering failed.',
    })
  } finally {
    for (const filePath of temporaryPaths) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch (cleanupError) {
          console.error('Could not clean up temporary segment:', cleanupError)
        }
      }
    }
  }
})

export default router
