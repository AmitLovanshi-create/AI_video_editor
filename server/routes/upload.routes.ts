
import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import { FFPROBE_PATH, uploadDir } from '../config/paths'
import { execFileAsync } from '../services/video-utils'

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(
      null,
      `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`,
    )
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

router.post(
  '/',
  (req, res, next) => {
    upload.single('video')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          error: err.message || 'Video upload failed.',
        })
        return
      }

      next()
    })
  },
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: 'No video file received.',
        })
        return
      }

      const { stdout } = await execFileAsync(FFPROBE_PATH, [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height',
        '-of',
        'json',
        req.file.path,
      ])

      const metadata = JSON.parse(stdout)

      const videoStream = metadata.streams?.find(
        (stream: { codec_type?: string }) =>
          stream.codec_type === 'video',
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
          hasAudio:
            metadata.streams?.some(
              (stream: { codec_type?: string }) =>
                stream.codec_type === 'audio',
            ) ?? false,
        },
      })
    } catch (error) {
      console.error('Upload processing failed:', error)

      res.status(500).json({
        error: 'Metadata extraction failed. Check FFprobe and the backend terminal.',
      })
    }
  },
)

export default router
