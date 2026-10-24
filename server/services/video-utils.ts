import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { FFPROBE_PATH, uploadDir } from '../config/paths'

export const execFileAsync = promisify(execFile)

// Find an uploaded video using its ID.
export function findUploadedFile(
  videoId: string,
): string | null {
  const filename = fs.readdirSync(uploadDir).find(
    (name) => path.parse(name).name === videoId,
  )

  return filename
    ? path.join(uploadDir, filename)
    : null
}

// Read a video's duration using FFprobe.
export async function getVideoDuration(
  filePath: string,
): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ])

  return Number(stdout.trim())
}