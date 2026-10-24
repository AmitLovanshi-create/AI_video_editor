
import { useRef, useState } from 'react'
import './App.css'


type VideoMetadata = {
  id: string
  originalName: string
  size: number
  durationSeconds: number
  width: number | null
  height: number | null
  hasAudio: boolean
}

type VideoClip = VideoMetadata & {
  localUrl: string
}

type TrimRange = {
  start: number
  end: number
}

function App() {
  const [clips, setClips] = useState<VideoClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState('')
  const [trimRanges, setTrimRanges] = useState<Record<string, TrimRange>>({})
  const [instruction, setInstruction] = useState('')
  const [planStatus, setPlanStatus] = useState('')
  const [isPlanning, setIsPlanning] = useState(false)
  const [editPlan, setEditPlan] = useState<{
    goal: string
    clips: { videoId: string; start: number; end: number }[]
    output: { format: 'mp4'; resolution: '720p' | '1080p' }
  } | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [renderUrl, setRenderUrl] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const [isTrimming, setIsTrimming] = useState(false)
  const [trimmedVideoUrl, setTrimmedVideoUrl] = useState('')
  const [trimError, setTrimError] = useState('')
  const [exportStatus, setExportStatus] = useState('')

  const [isMerging, setIsMerging] = useState(false)
  const [mergedVideoUrl, setMergedVideoUrl] = useState('')
  const [mergeStatus, setMergeStatus] = useState('')
  const [mergeError, setMergeError] = useState('')

  const videoRef = useRef<HTMLInputElement>(null)

  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? null

  const selectedRange: TrimRange = selectedClip
    ? trimRanges[selectedClip.id] ?? {
      start: 0,
      end: selectedClip.durationSeconds,
    }
    : { start: 0, end: 0 }

  const totalDuration = clips.reduce(
    (total, clip) => total + clip.durationSeconds,
    0,
  )

  const selectedDuration = clips.reduce((total, clip) => {
    const range = trimRanges[clip.id] ?? {
      start: 0,
      end: clip.durationSeconds,
    }

    return total + Math.max(0, range.end - range.start)
  }, 0)

  async function handleVideoUpload(fileList?: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const files = Array.from(fileList)
    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('video/')) {
        setUploadStatus(`${file.name}: not a valid video file. Skipped.`)
        return false
      }

      if (file.size > 500 * 1024 * 1024) {
        setUploadStatus(`${file.name}: larger than 500 MB. Skipped.`)
        return false
      }

      return true
    })

    if (validFiles.length === 0) return

    setIsUploading(true)
    setUploadStatus(`Uploading ${validFiles.length} video(s)...`)

    const uploadedClips: VideoClip[] = []
    const failedFiles: string[] = []

    for (const file of validFiles) {
      try {
        const formData = new FormData()
        formData.append('video', file)

        const response = await fetch('http://localhost:5000/api/upload', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Upload failed.')
        }

        uploadedClips.push({
          ...(result.file as VideoMetadata),
          localUrl: URL.createObjectURL(file),
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Upload failed.'
        failedFiles.push(`${file.name}: ${message}`)
      }
    }

    if (uploadedClips.length > 0) {
      setClips((previous) => [...previous, ...uploadedClips])

      const newRanges: Record<string, TrimRange> = {}
      for (const clip of uploadedClips) {
        newRanges[clip.id] = {
          start: 0,
          end: clip.durationSeconds,
        }
      }

      setTrimRanges((previous) => ({ ...previous, ...newRanges }))

      if (!selectedClipId) {
        setSelectedClipId(uploadedClips[0].id)
      }

      setTrimmedVideoUrl('')
      setExportStatus('')
      setTrimError('')
      setMergedVideoUrl('')
      setMergeStatus('')
      setMergeError('')
    }

    const successMessage =
      `${uploadedClips.length} video(s) uploaded successfully.`

    setUploadStatus(
      failedFiles.length > 0
        ? `${successMessage} Failed: ${failedFiles.join(' | ')}`
        : successMessage,
    )

    setIsUploading(false)
  }

  function handleSelectClip(clip: VideoClip) {
    setSelectedClipId(clip.id)
    setTrimmedVideoUrl('')
    setTrimError('')
    setExportStatus('')
  }

  function handleTrimRangeChange(
    clipId: string,
    field: 'start' | 'end',
    value: number,
  ) {
    const clip = clips.find((item) => item.id === clipId)
    if (!clip) return

    setTrimRanges((previous) => {
      const current = previous[clipId] ?? {
        start: 0,
        end: clip.durationSeconds,
      }

      let next: TrimRange

      if (field === 'start') {
        next = {
          start: Math.min(
            Math.max(0, value),
            Math.max(0, current.end - 0.1),
          ),
          end: current.end,
        }
      } else {
        next = {
          start: current.start,
          end: Math.max(
            Math.min(value, clip.durationSeconds),
            current.start + 0.1,
          ),
        }
      }

      return { ...previous, [clipId]: next }
    })

    setTrimmedVideoUrl('')
    setExportStatus('')
    setTrimError('')
    setMergedVideoUrl('')
    setMergeStatus('')
    setMergeError('')
  }

  function handleRemoveClip(clipId: string) {
    const clipToRemove = clips.find((clip) => clip.id === clipId)
    if (!clipToRemove) return

    URL.revokeObjectURL(clipToRemove.localUrl)

    const remainingClips = clips.filter((clip) => clip.id !== clipId)
    setClips(remainingClips)

    setTrimRanges((previous) => {
      const next = { ...previous }
      delete next[clipId]
      return next
    })

    setTrimmedVideoUrl('')
    setTrimError('')
    setExportStatus('')
    setMergedVideoUrl('')
    setMergeStatus('')
    setMergeError('')

    if (selectedClipId === clipId) {
      setSelectedClipId(remainingClips[0]?.id ?? '')
    }
  }

  async function handleExportTrim() {
    if (!selectedClip) {
      setTrimError('Please upload and select a video first.')
      return
    }

    const range = selectedRange

    if (
      range.start < 0 ||
      range.end <= range.start ||
      range.end > selectedClip.durationSeconds
    ) {
      setTrimError('Please select a valid trim range.')
      return
    }

    setIsTrimming(true)
    setTrimError('')
    setExportStatus('Rendering selected clip with FFmpeg...')
    setTrimmedVideoUrl('')

    try {
      const response = await fetch('http://localhost:5000/api/trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: selectedClip.id,
          start: range.start,
          end: range.end,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Video export failed.')
      }

      setTrimmedVideoUrl(`http://localhost:5000${result.downloadUrl}`)
      setExportStatus(
        `Export successful. Output duration: ${Number(result.durationSeconds).toFixed(1)} seconds.`,
      )
    } catch (error) {
      setTrimError(
        error instanceof Error ? error.message : 'Video export failed.',
      )
      setExportStatus('')
    } finally {
      setIsTrimming(false)
    }
  }

  async function handleExportCombined() {
    if (clips.length < 2) {
      setMergeError('Upload at least two clips to combine them.')
      return
    }

    const mergeClips = clips.map((clip) => {
      const range = trimRanges[clip.id] ?? {
        start: 0,
        end: clip.durationSeconds,
      }

      return {
        videoId: clip.id,
        start: range.start,
        end: range.end,
      }
    })

    const invalidIndex = mergeClips.findIndex(
      (clip, index) =>
        !Number.isFinite(clip.start) ||
        !Number.isFinite(clip.end) ||
        clip.start < 0 ||
        clip.end <= clip.start ||
        clip.end > clips[index].durationSeconds,
    )

    if (invalidIndex !== -1) {
      setMergeError(
        `Please check the trim range for "${clips[invalidIndex].originalName}".`,
      )
      return
    }

    setIsMerging(true)
    setMergeError('')
    setMergeStatus('Preparing clips and combining them with FFmpeg...')
    setMergedVideoUrl('')

    try {
      const response = await fetch('http://localhost:5000/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: mergeClips }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Combined export failed.')
      }

      setMergedVideoUrl(`http://localhost:5000${result.downloadUrl}`)
      setMergeStatus(
        `Combined export successful: ${result.clipCount} clips, ${Number(result.durationSeconds).toFixed(1)} seconds.`,
      )
    } catch (error) {
      setMergeError(
        error instanceof Error
          ? error.message
          : 'Combined export failed.',
      )
      setMergeStatus('')
    } finally {
      setIsMerging(false)
    }
  }
  async function handleCreateEditPlan() {
    if (!instruction.trim()) {
      setPlanStatus('Please enter your editing instructions first.')
      return
    }

    if (clips.length === 0) {
      setPlanStatus('Please upload at least one video first.')
      return
    }

    setIsPlanning(true)
    setPlanStatus('Validating edit plan...')

    try {
      const response = await fetch('http://localhost:5000/api/edit-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: instruction.trim(),
          clips: clips.map((clip) => {
            const range = trimRanges[clip.id] ?? {
              start: 0,
              end: clip.durationSeconds,
            }

            return {
              videoId: clip.id,
              start: range.start,
              end: range.end,
            }
          }),
          output: {
            format: 'mp4',
            resolution: '1080p',
          },
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          typeof result.errors === 'string'
            ? result.errors
            : result.message || 'Could not validate edit plan.',
        )
      }      setEditPlan(result.editPlan)
      setRenderUrl('')
      setPlanStatus(
        `AI plan ready: ${result.editPlan.clips.length} clip(s), ` +
        `${result.editPlan.output.resolution}, ${result.editPlan.output.format}. ` +
        'Review the plan, then click Render Video.',
      )
    } catch (error) {
      setPlanStatus(
        error instanceof Error ? error.message : 'Edit plan validation failed.',
      )
    } finally {
      setIsPlanning(false)
    }
  }
  async function handleRenderVideo() {
    if (!editPlan) {
      setPlanStatus('Please generate an AI edit plan first.')
      return
    }

    setIsRendering(true)
    setPlanStatus('Rendering video... Please wait.')
    setRenderUrl('')

    try {
      const response = await fetch('http://localhost:5000/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editPlan }),
      })
      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Video rendering failed.')
      }

      setRenderUrl(`http://localhost:5000${result.downloadUrl}`)
      setPlanStatus(
        `Video rendered successfully: ${result.clipCount} clip(s), ${result.resolution}.`,
      )
    } catch (error) {
      setPlanStatus(
        error instanceof Error ? error.message : 'Video rendering failed.',
      )
    } finally {
      setIsRendering(false)
    }
  }

  function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)

    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">V</span>
          <span>FRAME<span className="pink">FLOW</span></span>
        </div>
        <span className="project-label">AI VIDEO STUDIO</span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
        <h1>Turn your footage into <span>your story.</span></h1>
        <p className="subtitle">
          Upload multiple clips. Organize your timeline. Create your video.
        </p>
      </section>

      <section className="workspace">
        <div className="panel upload-panel">
          <div className="panel-heading">
            <span>01 / SOURCE MEDIA</span>
            <span className="status">{clips.length} CLIP(S)</span>
          </div>

          <div
            className="upload-area"
            onClick={() => videoRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleVideoUpload(event.dataTransfer.files)
            }}
          >
            <div className="upload-icon">↑</div>
            <h2>Bring your footage</h2>
            <p>Select or drag multiple video files here</p>
            <button
              className="secondary-button"
              type="button"
              disabled={isUploading}
              onClick={(event) => {
                event.stopPropagation()
                videoRef.current?.click()
              }}
            >
              {isUploading ? 'Uploading...' : 'Browse videos'}
            </button>
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              onChange={(event) => {
                void handleVideoUpload(event.target.files)
                event.target.value = ''
              }}
            />
          </div>

          {uploadStatus && (
            <p className="helper-text" role="status">{uploadStatus}</p>
          )}

          {clips.length > 0 && (
            <div className="clip-library">
              <h3>Media library</h3>
              {clips.map((clip) => (
                <div
                  className={`media-item ${clip.id === selectedClipId ? 'media-item-selected' : ''}`}
                  key={clip.id}
                >
                  <button
                    type="button"
                    className="media-select"
                    onClick={() => handleSelectClip(clip)}
                  >
                    <span className="media-file-name">{clip.originalName}</span>
                    <span className="media-details">
                      {clip.durationSeconds.toFixed(1)} sec ·{' '}
                      {clip.width ?? '?'} × {clip.height ?? '?'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="remove-clip-button"
                    aria-label={`Remove ${clip.originalName}`}
                    onClick={() => handleRemoveClip(clip.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedClip && (
            <div className="video-preview">
              <h3>Selected clip</h3>
              <video src={selectedClip.localUrl} controls />
              <p className="file-name">{selectedClip.originalName}</p>
              <div className="helper-text">
                <p>Duration: {selectedClip.durationSeconds.toFixed(1)} seconds</p>
                <p>Resolution: {selectedClip.width ?? '?'} × {selectedClip.height ?? '?'}</p>
                <p>Audio: {selectedClip.hasAudio ? 'Available' : 'No audio track'}</p>
              </div>
            </div>
          )}
        </div>

        <div className="panel prompt-panel">
          <div className="panel-heading">
            <span>02 / AI EDIT INSTRUCTIONS</span>
            <span className="ai-label">AI ASSISTANT</span>
          </div>

          <label htmlFor="edit-prompt">What should the edit look like?</label>
          <textarea
            id="edit-prompt"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Example: Arrange the clips into a short travel video..."
            rows={5}
          />

          <button
            className="primary-button"
            type="button"
            disabled={isPlanning}
            onClick={() => void handleCreateEditPlan()}
          >
            {isPlanning ? 'Validating...' : 'Create edit plan'} <span>→</span>
          </button>

          {planStatus && (
            <p className="helper-text" role="status">
              {planStatus}
            </p>
          )}

          {editPlan && (
            <div className="video-preview">
              <h3>AI edit plan review</h3>
              <p className="helper-text">{editPlan.goal}</p>
              <p className="helper-text">
                {editPlan.clips.length} clip(s) · {editPlan.output.resolution} · {editPlan.output.format.toUpperCase()}
              </p>
              <ol>
                {editPlan.clips.map((clip, index) => {
                  const sourceClip = clips.find((item) => item.id === clip.videoId)
                  return (
                    <li key={`${clip.videoId}-${index}`}>
                      {sourceClip?.originalName ?? `Clip ${index + 1}`} — {clip.start.toFixed(1)}s to {clip.end.toFixed(1)}s
                    </li>
                  )
                })}
              </ol>
              <button
                className="primary-button"
                type="button"
                disabled={isRendering || isPlanning}
                onClick={() => void handleRenderVideo()}
              >
                {isRendering ? 'Rendering video...' : 'Render Video'} <span>→</span>
              </button>
            </div>
          )}

          {renderUrl && (
            <div className="video-preview">
              <h3>AI-rendered final video</h3>
              <video src={renderUrl} controls />
              <p>
                <a href={renderUrl} download="frameflow-ai-edited.mp4">
                  Download AI-edited MP4
                </a>
              </p>
            </div>
          )}

          
        </div>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-heading">
          <span>03 / EDIT TIMELINE</span>
          <span className="status">{clips.length} CLIP(S)</span>
        </div>

        <div className="timeline-summary">
          Original duration: {totalDuration.toFixed(1)} seconds ·
          Selected output duration: {selectedDuration.toFixed(1)} seconds
        </div>

        <div className="timeline-ruler">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index}>
              {formatTime((totalDuration * index) / 4)}
            </span>
          ))}
        </div>

        {['VIDEO', 'B-ROLL', 'AUDIO', 'CAPTIONS'].map((track) => (
          <div className="track-row" key={track}>
            <span className="track-name">{track}</span>
            <div className="track-lane">
              {track === 'VIDEO' && clips.length > 0 ? (
                clips.map((clip) => {
                  const width =
                    totalDuration > 0
                      ? Math.max(
                        12,
                        (clip.durationSeconds / totalDuration) * 100,
                      )
                      : 12

                  return (
                    <button
                      key={clip.id}
                      type="button"
                      className={`clip timeline-clip ${clip.id === selectedClipId ? 'clip-selected' : ''}`}
                      title={`Select ${clip.originalName}`}
                      style={{ width: `${width}%` }}
                      onClick={() => handleSelectClip(clip)}
                    >
                      {clip.originalName}
                    </button>
                  )
                })
              ) : (
                <span className="empty-track">
                  {track === 'VIDEO'
                    ? 'Upload videos to begin'
                    : track === 'B-ROLL'
                      ? 'B-roll clips can be organized here later'
                      : track === 'AUDIO'
                        ? 'Audio track'
                        : 'Subtitle track'}
                </span>
              )}
            </div>
          </div>
        ))}

        {selectedClip && (
          <div className="trim-controls">
            <h3>Trim selected clip</h3>
            <p className="helper-text">{selectedClip.originalName}</p>

            <label>
              Start: {selectedRange.start.toFixed(1)} seconds
              <input
                type="range"
                min={0}
                max={Math.max(0, selectedClip.durationSeconds - 0.1)}
                step={0.1}
                value={Math.min(
                  selectedRange.start,
                  Math.max(0, selectedClip.durationSeconds - 0.1),
                )}
                onChange={(event) =>
                  handleTrimRangeChange(
                    selectedClip.id,
                    'start',
                    Number(event.target.value),
                  )
                }
              />
            </label>

            <label>
              End: {selectedRange.end.toFixed(1)} seconds
              <input
                type="range"
                min={0.1}
                max={selectedClip.durationSeconds}
                step={0.1}
                value={Math.max(
                  0.1,
                  Math.min(selectedRange.end, selectedClip.durationSeconds),
                )}
                onChange={(event) =>
                  handleTrimRangeChange(
                    selectedClip.id,
                    'end',
                    Number(event.target.value),
                  )
                }
              />
            </label>

            <p className="helper-text">
              Selected duration:{' '}
              {Math.max(
                0,
                selectedRange.end - selectedRange.start,
              ).toFixed(1)} seconds
            </p>

            <button
              className="primary-button"
              type="button"
              disabled={
                isTrimming ||
                isMerging ||
                selectedRange.end <= selectedRange.start ||
                selectedRange.end > selectedClip.durationSeconds
              }
              onClick={() => void handleExportTrim()}
            >
              {isTrimming ? 'Rendering video...' : 'Export selected clip'}
            </button>

            {exportStatus && <p className="helper-text">{exportStatus}</p>}
            {trimError && <p className="helper-text" role="alert">{trimError}</p>}

            {trimmedVideoUrl && (
              <div className="video-preview">
                <h3>Exported clip</h3>
                <video src={trimmedVideoUrl} controls />
                <p>
                  <a href={trimmedVideoUrl} download="frameflow-trimmed.mp4">
                    Download trimmed MP4
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        <div className="trim-controls">
          <h3>Export complete timeline</h3>
          <p className="helper-text">
            {clips.length} clips will be combined in the order shown above.
            Each clip will use its own saved trim range.
          </p>

          <button
            className="primary-button"
            type="button"
            disabled={isMerging || isTrimming || clips.length < 2}
            onClick={() => void handleExportCombined()}
          >
            {isMerging ? 'Combining clips...' : 'Export combined video'}
          </button>

          {mergeStatus && <p className="helper-text">{mergeStatus}</p>}
          {mergeError && <p className="helper-text" role="alert">{mergeError}</p>}

          {mergedVideoUrl && (
            <div className="video-preview">
              <h3>Combined final video</h3>
              <video src={mergedVideoUrl} controls />
              <p>
                <a href={mergedVideoUrl} download="frameflow-combined.mp4">
                  Download combined MP4
                </a>
              </p>
            </div>
          )}
        </div>
      </section>

      <footer>
        FRAMEFLOW <span>•</span> AI-NATIVE VIDEO EDITOR
      </footer>
    </main>
  )
}

export default App
