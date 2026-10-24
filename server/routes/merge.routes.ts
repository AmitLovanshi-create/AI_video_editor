
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { FFMPEG_PATH, FFPROBE_PATH, renderDir } from '../config/paths'
import {
  execFileAsync,
  findUploadedFile,
  getVideoDuration,
} from '../services/video-utils'

const router = Router()

router.post('/', async (req, res) => {
  const jobDir = path.join(renderDir, `merge-${randomUUID()}`)
  let outputPath = ''

  try {
    const { clips } = req.body ?? {}

    if (!Array.isArray(clips) || clips.length < 2 || clips.length > 20) {
      res.status(400).json({
        error: 'Please provide between 2 and 20 clips to combine.',
      })
      return
    }

    fs.mkdirSync(jobDir, { recursive: true })

    const segmentPaths: string[] = []

    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index]

      if (
        typeof clip?.videoId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(clip.videoId) ||
        typeof clip.start !== 'number' ||
        typeof clip.end !== 'number' ||
        !Number.isFinite(clip.start) ||
        !Number.isFinite(clip.end) ||
        clip.start < 0 ||
        clip.end <= clip.start
      ) {
        res.status(400).json({
          error: `Clip ${index + 1} has an invalid ID or trim range.`,
        })
        return
      }

      const inputPath = findUploadedFile(clip.videoId)

      if (!inputPath) {
        res.status(404).json({
          error: `Clip ${index + 1} was not found. Please upload it again.`,
        })
        return
      }

      const duration = await getVideoDuration(inputPath)

      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        clip.start >= duration ||
        clip.end > duration + 0.05
      ) {
        res.status(400).json({
          error: `Clip ${index + 1} has a trim range outside its duration.`,
        })
        return
      }

      const hasAudioResult = await execFileAsync(FFPROBE_PATH, [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ])

      const hasAudio = hasAudioResult.stdout.trim().length > 0
      const segmentPath = path.join(jobDir, `segment-${index}.mp4`)

      const args = [
        '-y',
        '-ss',
        String(clip.start),
        '-i',
        inputPath,
      ]

      if (!hasAudio) {
        args.push(
          '-f',
          'lavfi',
          '-t',
          String(clip.end - clip.start),
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100',
        )
      }

      args.push(
        '-t',
        String(clip.end - clip.start),
        '-map',
        '0:v:0',
      )

      if (hasAudio) {
        args.push('-map', '0:a:0')
      } else {
        args.push('-map', '1:a:0')
      }

      args.push(
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-b:a',
        '128k',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        segmentPath,
      )

      await execFileAsync(FFMPEG_PATH, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })

      if (
        !fs.existsSync(segmentPath) ||
        fs.statSync(segmentPath).size === 0
      ) {
        throw new Error(`FFmpeg failed to prepare clip ${index + 1}.`)
      }

      segmentPaths.push(segmentPath)
    }

    const concatListPath = path.join(jobDir, 'concat-list.txt')

    const concatList = segmentPaths
      .map((segmentPath) => {
        const safePath = segmentPath
          .replace(/\\/g, '/')
          .replace(/'/g, "'\\''")

        return `file '${safePath}'`
      })
      .join('\n')

    fs.writeFileSync(concatListPath, concatList, 'utf8')

    const outputName = `${randomUUID()}.mp4`
    outputPath = path.join(renderDir, outputName)

    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })

    const outputStats = fs.statSync(outputPath)

    if (outputStats.size === 0) {
      throw new Error('FFmpeg produced an empty combined video.')
    }

    const outputDuration = await getVideoDuration(outputPath)

    res.json({
      message: 'Clips combined successfully.',
      fileName: outputName,
      clipCount: clips.length,
      durationSeconds: outputDuration,
      size: outputStats.size,
      downloadUrl: `/renders/${outputName}`,
    })
  } catch (error) {
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath)
      } catch (cleanupError) {
        console.error(
          'Could not remove incomplete combined video:',
          cleanupError,
        )
      }
    }

    console.error('Video merge failed:', error)

    res.status(500).json({
      error: 'Could not combine videos. Check the backend terminal for details.',
    })
  } finally {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true })
    } catch (cleanupError) {
      console.error(
        'Could not remove temporary merge files:',
        cleanupError,
      )
    }
  }
})

export default router
