
import mic from "mic";
import querystring from "querystring";
import fs  from "fs";



// --- Configuration ---
// Replace with your chosen API key, this is the "default" account api key
const API_KEY = "46082243046945dda9cddb8eb44eb403";
const CAPTURE_RATE = 48000; // what your mic actually runs at
const CONNECTION_PARAMS = {
  sample_rate: 16000, // what AssemblyAI expects
  speech_model: "u3-rt-pro",
};
const API_ENDPOINT_BASE_URL = "wss://streaming.assemblyai.com/v3/ws";
const API_ENDPOINT = `${API_ENDPOINT_BASE_URL}?${querystring.stringify(CONNECTION_PARAMS)}`;

// Audio Configuration
const SAMPLE_RATE = CONNECTION_PARAMS.sample_rate;
const CHANNELS = 1;

// Global variables
let micInstance = null;
let micInputStream = null;
let ws = null;
let stopRequested = false;
let audioBuffer = Buffer.alloc(0);
// WAV recording variables
let recordedFrames = []; // Store audio frames for WAV file

// --- Helper functions ---
function clearLine() {
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}

function createWavHeader(sampleRate, channels, dataLength) {
  const buffer = Buffer.alloc(44);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buffer.writeUInt16LE(channels * 2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function saveWavFile() {
  if (recordedFrames.length === 0) {
    console.log("No audio data recorded.");
    return;
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `recorded_audio_${timestamp}.wav`;

  try {
    // Combine all recorded frames
    const audioData = Buffer.concat(recordedFrames);
    const dataLength = audioData.length;

    // Create WAV header
    const wavHeader = createWavHeader(SAMPLE_RATE, CHANNELS, dataLength);

    // Write WAV file
    const wavFile = Buffer.concat([wavHeader, audioData]);
    fs.writeFileSync(filename, wavFile);

    console.log(`Audio saved to: ${filename}`);
    console.log(
      `Duration: ${(dataLength / (SAMPLE_RATE * CHANNELS * 2)).toFixed(2)} seconds`,
    );
  } catch (error) {
    console.error(`Error saving WAV file: ${error}`);
  }
}

// --- Main function ---
async function run() {
  console.log("Starting AssemblyAI streaming transcription...");
  console.log("Audio will be saved to a WAV file when the session ends.");

  // Initialize WebSocket connection
  ws = new WebSocket(API_ENDPOINT, {
    headers: {
      Authorization: API_KEY,
    },
  });

  // Setup WebSocket event handlers
  ws.on("open", () => {
    console.log("WebSocket connection opened.");
    console.log(`Connected to: ${API_ENDPOINT}`);
    // Start the microphone
    startMicrophone();
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      const msgType = data.type;

      if (msgType === "Begin") {
        const sessionId = data.id;
        const expiresAt = data.expires_at;
        console.log(
          `\nSession began: ID=${sessionId}, ExpiresAt=${formatTimestamp(expiresAt)}`,
        );
      } else if (msgType === "Turn") {
        const transcript = data.transcript || "";
        const formatted = data.turn_is_formatted;

        if (formatted) {
          clearLine();
          console.log(transcript);
        } else {
          process.stdout.write(`\r${transcript}`);
        }
      } else if (msgType === "Termination") {
        const audioDuration = data.audio_duration_seconds;
        const sessionDuration = data.session_duration_seconds;
        console.log(
          `\nSession Terminated: Audio Duration=${audioDuration}s, Session Duration=${sessionDuration}s`,
        );
      }
    } catch (error) {
      console.error(`\nError handling message: ${error}`);
      console.error(`Message data: ${message}`);
    }
  });

  ws.on("error", (error) => {
    console.error(`\nWebSocket Error: ${error}`);
    cleanup();
  });

  ws.on("close", (code, reason) => {
    console.log(`\nWebSocket Disconnected: Status=${code}, Msg=${reason}`);
    cleanup();
  });

  // Handle process termination
  setupTerminationHandlers();
}

function startMicrophone() {
  try {
    micInstance = mic({
      rate: "9000",
      channels: CHANNELS.toString(),
      debug: false,
      encoding: "signed-integer",
      bitwidth: "16",
      endian: "little",
      device: "default",
    });

    micInputStream = micInstance.getAudioStream();

    let audioBuffer = Buffer.alloc(0); // Add this above startMicrophone()
    const MIN_CHUNK_BYTES = 8820; // 100ms at 16kHz 16-bit mono (16000 * 2 * 0.1)

    micInputStream.on("data", (data) => {
      if (ws && ws.readyState === WebSocket.OPEN && !stopRequested) {
        // Store for WAV recording
        recordedFrames.push(Buffer.from(data));

        // Accumulate audio
        audioBuffer = Buffer.concat([audioBuffer, data]);

        // Send only when we have enough data (≥100ms)
        while (audioBuffer.length >= MIN_CHUNK_BYTES) {
          const chunk = audioBuffer.slice(0, MIN_CHUNK_BYTES);
          audioBuffer = audioBuffer.slice(MIN_CHUNK_BYTES);
          ws.send(chunk);
        }
      }
    });

    micInputStream.on("error", (err) => {
      console.error(`Microphone Error: ${err}`);
      cleanup();
    });

    micInstance.start();
    console.log("Microphone stream opened successfully.");
    console.log("Speak into your microphone. Press Ctrl+C to stop.");
  } catch (error) {
    console.error(`Error opening microphone stream: ${error}`);
    cleanup();
  }
}

function cleanup() {
  stopRequested = true;

  // Save recorded audio to WAV file
  saveWavFile();

  // Stop microphone if it's running
  if (micInstance) {
    try {
      micInstance.stop();
    } catch (error) {
      console.error(`Error stopping microphone: ${error}`);
    }
    micInstance = null;
  }

  // Close WebSocket connection if it's open
  if (ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) {
    try {
      // Send termination message if possible
      if (ws.readyState === WebSocket.OPEN) {
        const terminateMessage = { type: "Terminate" };
        console.log(
          `Sending termination message: ${JSON.stringify(terminateMessage)}`,
        );
        ws.send(JSON.stringify(terminateMessage));
      }
      ws.close();
    } catch (error) {
      console.error(`Error closing WebSocket: ${error}`);
    }
    ws = null;
  }

  console.log("Cleanup complete.");
}

function setupTerminationHandlers() {
  // Handle Ctrl+C and other termination signals
  process.on("SIGINT", () => {
    console.log("\nCtrl+C received. Stopping...");
    cleanup();
    // Give time for cleanup before exiting
    setTimeout(() => process.exit(0), 1000);
  });

  process.on("SIGTERM", () => {
    console.log("\nTermination signal received. Stopping...");
    cleanup();
    // Give time for cleanup before exiting
    setTimeout(() => process.exit(0), 1000);
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error(`\nUncaught exception: ${error}`);
    cleanup();
    // Give time for cleanup before exiting
    setTimeout(() => process.exit(1), 1000);
  });
}

// Start the application
run();



