import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import uploadRouter from './routes/upload.routes'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import trimRouter from './routes/trim.routes'
import mergeRouter from './routes/merge.routes'
import editPlanRouter from './routes/edit-plan.routes'
import renderRouter from './routes/render.routes'

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

app.use('/api/edit-plan', editPlanRouter)




app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Video Editor backend is running',
  })
})


app.use('/api/upload', uploadRouter)
// Combine multiple clips into one MP4 in the order supplied by the frontend.
// Request body: { clips: [{ videoId, start, end }, ...] }


app.use('/api/trim', trimRouter)
app.use('/api/merge', mergeRouter)
app.use('/api/render', renderRouter)

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
