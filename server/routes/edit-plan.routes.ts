import { Router } from 'express'
import { validateEditPlan } from '../services/edit-planner'
import { generateEditPlan } from '../services/ai-planner'
import { getUploadedVideoMetadata } from '../tools/video-tools'

const router = Router()

router.post('/', async (req, res) => {
  try {
    const { goal, clips } = req.body

    if (typeof goal !== 'string' || !goal.trim()) {
      res.status(400).json({
        success: false,
        message: 'Please provide editing instructions.',
      })
      return
    }

    if (!Array.isArray(clips) || clips.length === 0 || clips.length > 20) {
      res.status(400).json({
        success: false,
        message: 'Provide between 1 and 20 uploaded video clips.',
      })
      return
    }

    const videos = await Promise.all(
      clips.map(async (clip: { videoId?: string }) => {
        if (typeof clip?.videoId !== 'string') {
          throw new Error('A clip has an invalid video ID.')
        }

        return getUploadedVideoMetadata(clip.videoId)
      }),
    )

    const generatedPlan = await generateEditPlan(goal.trim(), videos)
    const editPlan = validateEditPlan(generatedPlan)

    for (const clip of editPlan.clips) {
      const video = videos.find((item) => item.videoId === clip.videoId)

      if (!video) {
        throw new Error('AI returned a video ID that was not provided.')
      }

      if (clip.end > video.durationSeconds) {
        throw new Error(
          `AI generated an end time beyond the duration of video ${clip.videoId}.`,
        )
      }
    }

    res.json({
      success: true,
      message: 'AI edit plan generated and validated successfully.',
      editPlan,
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Could not generate a valid AI edit plan.',
      errors: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router