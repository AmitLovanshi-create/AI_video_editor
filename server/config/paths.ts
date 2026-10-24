import fs from 'node:fs'
import path from 'node:path'

// FFmpeg installation path.
// Environment variables allow us to change the paths later.
const ffmpegBinDir = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft',
  'WinGet',
  'Packages',
  'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'ffmpeg-9.0.1-essentials_build',
  'bin',
)

export const FFMPEG_PATH =
  process.env.FFMPEG_PATH || path.join(ffmpegBinDir, 'ffmpeg.exe')

export const FFPROBE_PATH =
  process.env.FFPROBE_PATH || path.join(ffmpegBinDir, 'ffprobe.exe')

// Project data directories.
// This preserves the current folder layout.
export const rootDir = path.resolve(process.cwd(), '..')

export const uploadDir = path.join(
  rootDir,
  'data',
  'uploads',
)

export const renderDir = path.join(
  rootDir,
  'data',
  'renders',
)

// Create the data directories if they do not exist.
fs.mkdirSync(uploadDir, { recursive: true })
fs.mkdirSync(renderDir, { recursive: true })