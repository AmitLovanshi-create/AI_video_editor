
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  uploadDir,
  renderDir,
} from './config/paths'

import {
  execFileAsync,
  findUploadedFile,
  getVideoDuration,
} from './services/video-utils'
const app = express()
const PORT = 5000


app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
}))

app.use(express.json({ limit: '1mb' }))

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true)
    } else {
      cb(new Error('Please upload a video file.'))
    }
  },
})


app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Video Editor backend is running',
  })
})

// Upload a video and return its metadata.
app.post('/api/upload', (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Video upload failed.' })
      return
    }
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No video file received.' })
      return
    }

    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,width,height',
      '-of', 'json',
      req.file.path,
    ])

    const metadata = JSON.parse(stdout)
    const videoStream = metadata.streams?.find(
      (stream: { codec_type?: string }) => stream.codec_type === 'video',
    )

    if (!videoStream) {
      fs.unlinkSync(req.file.path)
      res.status(400).json({
        error: 'The uploaded file does not contain a valid video stream.',
      })
      return
    }

    res.status(201).json({
      message: 'Video uploaded successfully.',
      file: {
        id: path.parse(req.file.filename).name,
        originalName: req.file.originalname,
        size: req.file.size,
        durationSeconds: Number(metadata.format?.duration ?? 0),
        width: videoStream.width ?? null,
        height: videoStream.height ?? null,
        hasAudio: metadata.streams?.some(
          (stream: { codec_type?: string }) => stream.codec_type === 'audio',
        ) ?? false,
      },
    })
  } catch (error) {
    console.error('Upload processing failed:', error)
    res.status(500).json({
      error: 'Metadata extraction failed. Check FFprobe and the backend terminal.',
    })
  }
})

// Trim one uploaded video.
app.post('/api/trim', async (req, res) => {
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
      res.status(400).json({ error: 'Invalid video ID or trim range.' })
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
    if (stats.size === 0) throw new Error('FFmpeg produced an empty file.')

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
        console.error('Could not remove incomplete render:', cleanupError)
      }
    }

    console.error('Video trimming failed:', error)
    res.status(500).json({ error: 'Video trimming failed. Check the backend terminal.' })
  }
})

// Combine multiple clips into one MP4 in the order supplied by the frontend.
// Request body: { clips: [{ videoId, start, end }, ...] }
app.post('/api/merge', async (req, res) => {
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
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ])

      const hasAudio = hasAudioResult.stdout.trim().length > 0
      const segmentPath = path.join(jobDir, `segment-${index}.mp4`)

      const args = [
        '-y',
        '-ss', String(clip.start),
        '-i', inputPath,
      ]

      if (!hasAudio) {
        args.push(
          '-f', 'lavfi',
          '-t', String(clip.end - clip.start),
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        )
      }

      args.push(
        '-t', String(clip.end - clip.start),
        '-map', '0:v:0',
      )

      if (hasAudio) {
        args.push('-map', '0:a:0')
      } else {
        args.push('-map', '1:a:0')
      }

      args.push(
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '128k',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        segmentPath,
      )

      await execFileAsync(FFMPEG_PATH, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })

      if (!fs.existsSync(segmentPath) || fs.statSync(segmentPath).size === 0) {
        throw new Error(`FFmpeg failed to prepare clip ${index + 1}.`)
      }

      segmentPaths.push(segmentPath)
    }

    // Create a concat list using absolute paths and FFmpeg-safe quoting.
    const concatListPath = path.join(jobDir, 'concat-list.txt')
    const concatList = segmentPaths
      .map((segmentPath) => {
        const safePath = segmentPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
        return `file '${safePath}'`
      })
      .join('\n')

    fs.writeFileSync(concatListPath, concatList, 'utf8')

    const outputName = `${randomUUID()}.mp4`
    outputPath = path.join(renderDir, outputName)

    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-movflags', '+faststart',
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
        console.error('Could not remove incomplete combined video:', cleanupError)
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
      console.error('Could not remove temporary merge files:', cleanupError)
    }
  }
})

app.use('/renders', express.static(renderDir, {
  index: false,
  dotfiles: 'deny',
}))

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' })
})

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`)
})
