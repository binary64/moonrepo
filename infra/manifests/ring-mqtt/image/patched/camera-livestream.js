import { parentPort, workerData } from 'worker_threads'
import { WebrtcConnection } from '../lib/streaming/webrtc-connection.js'
import { StreamingSession } from '../lib/streaming/streaming-session.js'
// two-way-audio patch (Arthur): used to stage remote audio to a local temp file
// before handing it to ffmpeg (see speak() below).
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const deviceName = workerData.deviceName
const doorbotId = workerData.doorbotId
let liveStream = false
let streamStopping = false

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    switch (data.command) {
        case 'start':
            if (streamStopping) {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because it is in stopping state"})
                parentPort.postMessage({type: 'state', data: 'failed'})
            } else if (!liveStream) {
                startLiveStream(streamData)
            } else {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because there is already an active stream"})
                parentPort.postMessage({type: 'state', data: 'active'})
            }
            break;
        case 'stop':
            if (liveStream) {
                stopLiveStream()
            }
            break;
        // --- two-way-audio patch (Arthur) ---------------------------------
        // Open a short-lived WebRTC session, activate the camera speaker and
        // transcode a single audio source (URL or file path) out the doorbell
        // speaker, then tear the session down.  Independent of the live/event
        // streaming worker state above so it never collides with a viewer.
        case 'speak':
            speak(streamData)
            break;
        // ------------------------------------------------------------------
    }
})

async function startLiveStream(streamData) {
    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC worker received start command'})
    try {
        const cameraData = {
            name: deviceName,
            id: doorbotId
        }

        const streamConnection = new WebrtcConnection(streamData.ticket, cameraData)
        liveStream = new StreamingSession(cameraData, streamConnection)

        liveStream.connection.pc.onConnectionState.subscribe(async (data) => {
            switch(data) {
                case 'connected':
                    parentPort.postMessage({type: 'state', data: 'active'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session is connected'})
                    break;
                case 'failed':
                    parentPort.postMessage({type: 'state', data: 'failed'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC connection has failed'})
                    liveStream.stop()
                    await new Promise(res => setTimeout(res, 2000))
                    liveStream = false
                    break;
            }
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process is starting'})
        await liveStream.startTranscoding({
            // The native AVC video stream is copied to the RTSP server unmodified while the audio
            // stream is converted into two output streams using both AAC and Opus codecs.  This
            // provides a stream with wide compatibility across various media player technologies.
            audio: [
                '-map', '0:v',
                '-map', '0:a',
                '-map', '0:a',
                '-c:a:0', 'aac',
                '-c:a:1', 'copy',
            ],
            video: [
                '-c:v', 'copy'
            ],
            output: [
                '-flags', '+global_header',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                streamData.rtspPublishUrl
            ]
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process has started'})

        liveStream.onCallEnded.subscribe(() => {
            parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session has disconnected'})
            parentPort.postMessage({type: 'state', data: 'inactive'})
            liveStream = false
        })
    } catch(error) {
        parentPort.postMessage({type: 'log_error', data: error})
        parentPort.postMessage({type: 'state', data: 'failed'})
        liveStream = false
    }
}

async function stopLiveStream() {
    if (!streamStopping) {
        streamStopping = true
        let stopTimeout = 10
        liveStream.stop()
        do {
            await new Promise(res => setTimeout(res, 200))
            if (liveStream) {
                parentPort.postMessage({type: 'log_info', data: 'Live stream failed to stop on request, deleting anyway...'})
                parentPort.postMessage({type: 'state', data: 'inactive'})
                liveStream = false
            }
            stopTimeout--
        } while (liveStream && stopTimeout)
        streamStopping = false
    }
}

// --- two-way-audio patch (Arthur) -------------------------------------------
// Play a single audio source out the camera speaker over its own WebRTC
// session.  streamData = { ticket, audioUrl, maxSeconds }.
async function speak(streamData) {
    parentPort.postMessage({type: 'log_info', data: `Speak: worker received speak command (${streamData.audioUrl})`})
    let speakSession = false
    let settled = false
    let tempFile = null
    const cameraData = { name: deviceName, id: doorbotId }
    const maxMs = Math.min(Math.max((streamData.maxSeconds || 30), 1), 60) * 1000

    // transcodeReturnAudio's ffmpeg runs with -protocol_whitelist
    // 'pipe,udp,rtp,file,crypto' — it will NOT read http(s)/tcp/tls sources.
    // So for a remote URL we fetch the bytes here and stage them to a local
    // temp file, then feed ffmpeg the file path (which IS whitelisted).
    let localSource = streamData.audioUrl
    if (/^https?:\/\//i.test(streamData.audioUrl)) {
        try {
            const controller = new AbortController()
            const fetchGuard = setTimeout(() => controller.abort(), 15000)
            const res = await fetch(streamData.audioUrl, { signal: controller.signal })
            clearTimeout(fetchGuard)
            if (!res.ok) { throw new Error(`HTTP ${res.status}`) }
            const buf = Buffer.from(await res.arrayBuffer())
            tempFile = join(tmpdir(), `ring-speak-${doorbotId}-${Date.now()}`)
            await writeFile(tempFile, buf)
            localSource = tempFile
            parentPort.postMessage({type: 'log_info', data: `Speak: staged remote audio (${buf.length} bytes) to ${tempFile}`})
        } catch (error) {
            parentPort.postMessage({type: 'log_error', data: `Speak: failed to fetch remote audio: ${error}`})
            if (tempFile) { try { await unlink(tempFile) } catch (e) { /* noop */ } }
            return
        }
    }

    const finish = (reason) => {
        if (settled) { return }
        settled = true
        try { if (speakSession) { speakSession.stop() } } catch (e) { /* noop */ }
        if (tempFile) { unlink(tempFile).catch(() => { /* noop */ }) }
        parentPort.postMessage({type: 'log_info', data: `Speak: session ended (${reason})`})
        parentPort.postMessage({type: 'speak_state', data: 'done'})
    }

    try {
        const speakConnection = new WebrtcConnection(streamData.ticket, cameraData)
        speakSession = new StreamingSession(cameraData, speakConnection)

        // Hard ceiling so a stalled session can never wedge the worker.
        const guard = setTimeout(() => finish('timeout'), maxMs)
        speakSession.onCallEnded.subscribe(() => { clearTimeout(guard); finish('callEnded') })

        speakConnection.pc.onConnectionState.subscribe(async (state) => {
            if (state === 'connected') {
                parentPort.postMessage({type: 'log_info', data: 'Speak: WebRTC connected, activating speaker'})
                speakSession.activateCameraSpeaker()
                // transcodeReturnAudio spawns ffmpeg (-re) reading the source and
                // streaming Opus RTP to the speaker; ffmpeg exit ends the call.
                // localSource is always a local path/file URL here.
                await speakSession.transcodeReturnAudio({ input: [localSource] })
            } else if (state === 'failed') {
                parentPort.postMessage({type: 'log_error', data: 'Speak: WebRTC connection failed'})
                clearTimeout(guard)
                finish('failed')
            }
        })
    } catch (error) {
        parentPort.postMessage({type: 'log_error', data: `Speak: ${error}`})
        finish('error')
    }
}
// ----------------------------------------------------------------------------
