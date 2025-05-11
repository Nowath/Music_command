const ffmpeg = require("ffmpeg-static");
require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    Partials,
    ChannelType,
    ComponentType,
    MessageFlags,
} = require("discord.js");
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    StreamType,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    NoSubscriberBehavior,
    getVoiceConnection,
} = require("@discordjs/voice");
const play = require("play-dl");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// --- Configuration ---
const BOT_NAME = "Jelly Bot";
const BOT_LOGO_URL =
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZGoxOGc0NTFncnNob3R3eHBsazFkajU1OG1uODc4cm82OTFmb2UzcSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/vkb4aEjq5TqqQ/giphy.gif";
const PINK_PASTEL_COLOR = 0xffc0cb;
const WELCOME_SOUND_PATH = path.join(__dirname, "audio", "welcome.mp3");
const GOODBYE_SOUND_PATH = path.join(__dirname, "audio", "goodbye.mp3");
const ALLOWED_MUSIC_CHANNEL_ID = "1353331984637890654"; // <<== ใส่ Channel ID ของคุณที่นี่
const AUDIO_CACHE_DIR = path.join(__dirname, "audiocache_jelly");
const YT_DLP_AUDIO_QUALITY = "0"; // <<--- ตั้งค่าคุณภาพเสียงดีที่สุด (0) สำหรับ yt-dlp

if (!fs.existsSync(AUDIO_CACHE_DIR)) {
    fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
    console.log(`Created audio cache directory at: ${AUDIO_CACHE_DIR}`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
});

const guildQueues = new Map();

// --- Helper Functions ---
function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;
    }
}

// --- UI Creation Functions ---
function createMusicEmbed(guildId, statusMessage = null) {
    const queue = guildQueues.get(guildId);
    if (!queue) {
        return new EmbedBuilder()
            .setColor(PINK_PASTEL_COLOR)
            .setAuthor({ name: BOT_NAME, iconURL: BOT_LOGO_URL })
            .setTitle("Music session ended or not found.")
            .setTimestamp();
    }

    const currentSong = queue.currentSong;
    const embed = new EmbedBuilder()
        .setColor(PINK_PASTEL_COLOR)
        .setAuthor({ name: BOT_NAME, iconURL: BOT_LOGO_URL })
        .setTimestamp();

    let description = statusMessage ? `${statusMessage}\n\n` : ""; // มี \n\n เพื่อให้มีช่องว่างถ้ามี currentSong

    if (currentSong) {
        embed.setTitle(currentSong.title || "Unknown Title");
        if (isValidHttpUrl(currentSong.url)) {
            embed.setURL(currentSong.url);
        }

        if (currentSong.thumbnail && isValidHttpUrl(currentSong.thumbnail)) {
            embed.setImage(currentSong.thumbnail);
        } else {
            embed.setImage(BOT_LOGO_URL);
        }
        // เพิ่มข้อมูลเพลงปัจจุบันเข้า description ถ้ายังไม่มี statusMessage หรือถ้า statusMessage ไม่ได้ครอบคลุมข้อมูลนี้แล้ว
        if (
            !statusMessage ||
            !statusMessage
                .toLowerCase()
                .includes(currentSong.title.toLowerCase())
        ) {
            description += `**🎶 ${
                queue.isPlaying &&
                queue.audioPlayer?.state.status === AudioPlayerStatus.Playing
                    ? "กำลังเล่น"
                    : "เตรียมเล่น"
            }:** [${
                currentSong.title.substring(0, 60) +
                (currentSong.title.length > 60 ? "..." : "")
            }](${isValidHttpUrl(currentSong.url) ? currentSong.url : "#"})`;
        }

        embed.addFields(
            {
                name: "🎤 ขอโดย",
                value: `<@${currentSong.requestedBy}>`,
                inline: true,
            },
            {
                name: "🎧 ช่องเสียง",
                value: `${queue.voiceChannel.name}`,
                inline: true,
            },
            {
                name: "⏳ ความยาว",
                value: currentSong.durationFormatted || "N/A",
                inline: true,
            }
        );
        if (queue.songs.length > 0) {
            embed.addFields({
                name: "⏭️ เพลงถัดไป",
                value: `[${
                    queue.songs[0].title.substring(0, 50) +
                    (queue.songs[0].title.length > 50 ? "..." : "")
                }](${
                    isValidHttpUrl(queue.songs[0].url)
                        ? queue.songs[0].url
                        : "#"
                })`,
            });
        } else {
            embed.addFields({ name: "⏭️ เพลงถัดไป", value: "ไม่มีเพลงในคิว" });
        }
    } else if (queue.songs.length > 0) {
        // ไม่มีเพลงปัจจุบัน แต่มีเพลงในคิว
        embed.setTitle("คิวเพลง");
        if (!statusMessage) {
            // ถ้ายังไม่มี status message ให้ใส่ default
            description += `มี ${
                queue.songs.length
            } เพลงในคิว.\n**🎶 เพลงถัดไป:** [${
                queue.songs[0].title.substring(0, 50) +
                (queue.songs[0].title.length > 50 ? "..." : "")
            }](${
                isValidHttpUrl(queue.songs[0].url) ? queue.songs[0].url : "#"
            })`;
        }
    } else {
        // ไม่มีทั้งเพลงปัจจุบันและเพลงในคิว
        embed.setTitle("ไม่ได้เล่นเพลงอยู่");
        if (!statusMessage) description += "คิวว่างเปล่า หรือ หยุดเล่นชั่วคราว";
    }

    embed.setDescription(description.trim() || null);

    if (queue.songs.length > 0) {
        let queueString = queue.songs
            .slice(0, 5)
            .map(
                (song, index) =>
                    `${index + 1}. ${
                        song.title.substring(0, 40) +
                        (song.title.length > 40 ? "..." : "")
                    }`
            )
            .join("\n");
        if (queue.songs.length > 5) {
            queueString += `\n...และอีก ${queue.songs.length - 5} เพลง`;
        }
        embed.addFields({
            name: "📜 คิวเพลง (สูงสุด 25 เพลงใน Select Menu)",
            value: queueString || "ว่างเปล่า",
        });
    } else if (currentSong) {
        // ถ้ามีเพลงเล่นอยู่แต่คิวว่าง
        embed.addFields({ name: "📜 คิวเพลง", value: "ว่างเปล่า" });
    }
    return embed;
}

function createMusicComponents(guildId) {
    const queue = guildQueues.get(guildId);
    const isPlaying =
        queue &&
        queue.isPlaying &&
        queue.audioPlayer &&
        queue.audioPlayer.state.status === AudioPlayerStatus.Playing;
    const isPaused =
        queue &&
        queue.audioPlayer &&
        queue.audioPlayer.state.status === AudioPlayerStatus.Paused;
    const hasQueueOrPlaying =
        queue && (queue.currentSong || queue.songs.length > 0);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_replay")
            .setLabel("เล่นซ้ำ")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔁")
            .setDisabled(!queue || !queue.currentSong),
        new ButtonBuilder()
            .setCustomId("music_shuffle_queue")
            .setLabel("สุ่มคิว")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔀")
            .setDisabled(!queue || queue.songs.length < 2),
        new ButtonBuilder()
            .setCustomId("music_skip")
            .setLabel("ข้าม")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("⏭️")
            .setDisabled(
                !queue || (!queue.currentSong && queue.songs.length === 0)
            ),
        new ButtonBuilder()
            .setCustomId("music_play_pause")
            .setLabel(isPlaying ? "หยุดชั่วคราว" : "เล่น")
            .setStyle(isPlaying ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setEmoji(isPlaying ? "⏸️" : "▶️")
            .setDisabled(
                !queue ||
                    (!queue.currentSong &&
                        queue.songs.length === 0 &&
                        !isPaused)
            ),
        new ButtonBuilder()
            .setCustomId("music_stop")
            .setLabel("หยุด")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⏹️")
            .setDisabled(!hasQueueOrPlaying)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_clear_queue")
            .setLabel("ล้างคิว")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🗑️")
            .setDisabled(
                !queue || (queue.songs.length === 0 && !queue.currentSong)
            ),
        new ButtonBuilder()
            .setCustomId("music_info")
            .setLabel("ข้อมูล")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("ℹ️"),
        new ButtonBuilder()
            .setCustomId("music_leave")
            .setLabel("บอทออก")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🚪")
            .setDisabled(
                !queue ||
                    !queue.connection ||
                    queue.connection.state.status ===
                        VoiceConnectionStatus.Destroyed
            ),
        new ButtonBuilder()
            .setCustomId("music_sound_settings")
            .setLabel("ตั้งค่าเสียง")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔊")
            .setDisabled(!queue)
    );

    const components = [row1, row2];

    if (queue && queue.songs.length > 0) {
        const selectMenuRow = new ActionRowBuilder();
        const songOptions = queue.songs.slice(0, 25).map((song, index) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`${index + 1}. ${song.title.substring(0, 90)}`)
                .setDescription(`เลือกเพื่อเล่นเพลงนี้ถัดไป`)
                .setValue(`select_song_${index}`)
        );

        if (songOptions.length > 0) {
            selectMenuRow.addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("music_select_from_queue")
                    .setPlaceholder("🎵 เลือกเพลงจากในคิวเพื่อเล่นถัดไป...")
                    .addOptions(songOptions)
            );
            components.push(selectMenuRow);
        }
    }
    return components;
}

// --- ฟังก์ชันเล่นเสียง Local ---
async function playLocalSound(guildId, filePath, isFinalSound = false) {
    const queue = guildQueues.get(guildId);
    console.log(
        `[${guildId}] playLocalSound called for ${filePath}. Final: ${isFinalSound}`
    );
    if (
        !queue ||
        !queue.connection ||
        queue.connection.state.status === VoiceConnectionStatus.Destroyed
    ) {
        console.warn(
            `[${guildId}] playLocalSound: No active connection or queue for ${filePath}.`
        );
        return;
    }
    if (!fs.existsSync(filePath)) {
        console.warn(`[${guildId}] Local sound not found: ${filePath}`);
        return;
    }

    const localPlayer = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
    });
    const resource = createAudioResource(filePath);
    let subscription;

    try {
        subscription = queue.connection.subscribe(localPlayer);
        if (!subscription) {
            localPlayer.stop();
            return;
        }
        localPlayer.play(resource);
        await entersState(localPlayer, AudioPlayerStatus.Idle, 15_000);
    } catch (err) {
        console.warn(
            `[${guildId}] Local sound ${filePath} playback error or timed out.`,
            err
        );
    } finally {
        localPlayer.stop();
        if (subscription?.isActive) {
            try {
                subscription.unsubscribe();
            } catch (unsubError) {
                console.warn(
                    `[${guildId}] Error unsubscribing localPlayer:`,
                    unsubError.message
                );
            }
        }
        if (
            !isFinalSound &&
            queue.audioPlayer &&
            queue.connection.state.status === VoiceConnectionStatus.Ready
        ) {
            try {
                if (
                    !queue.connection.state.subscription ||
                    queue.connection.state.subscription.player !==
                        queue.audioPlayer
                ) {
                    queue.connection.subscribe(queue.audioPlayer);
                }
            } catch (resubError) {
                console.error(
                    `[${guildId}] Error re-subscribing main audio player:`,
                    resubError
                );
            }
        }
    }
}

// --- Audio Playing Logic (Download First with yt-dlp) ---
async function playNextSong(guildId) {
    const queue = guildQueues.get(guildId);
    console.log(`[${guildId}] playNextSong called. Queue exists: ${!!queue}`);
    if (!queue) return;

    if (queue.songs.length > 0) {
        queue.currentSong = queue.songs.shift();
        console.log(
            `[${guildId}] Next song: ${queue.currentSong.title} (Source: ${
                queue.currentSong.sourceType
            }, URL for download: ${
                queue.currentSong.urlToDownload || queue.currentSong.url
            })`
        );
        await updateNowPlayingMessage(
            guildId,
            `📥 กำลังดาวน์โหลด: **${queue.currentSong.title}**... โปรดรอสักครู่`
        );
    } else {
        queue.currentSong = null;
        queue.isPlaying = false;
        console.log(`[${guildId}] Queue is empty.`);
        await updateNowPlayingMessage(guildId, "🎶 คิวเพลงหมดแล้ว!");
        if (
            queue.connection &&
            queue.connection.state.status !== VoiceConnectionStatus.Destroyed &&
            fs.existsSync(GOODBYE_SOUND_PATH)
        ) {
            await playLocalSound(guildId, GOODBYE_SOUND_PATH, true);
        }
        queue.idleTimeout = setTimeout(() => {
            if (
                queue.connection &&
                !queue.currentSong &&
                queue.connection.state.status !==
                    VoiceConnectionStatus.Destroyed
            ) {
                if (queue.nowPlayingMessage) {
                    queue.connection.destroy();
                } else {
                    queue.textChannel
                        .send("👋 ออกจากช่องเสียงเนื่องจากไม่มีการใช้งาน")
                        .catch((e) =>
                            console.error("Error sending inactivity message", e)
                        );
                    queue.connection.destroy();
                }
            }
        }, 2 * 60 * 1000);
        return;
    }

    if (queue.idleTimeout) {
        clearTimeout(queue.idleTimeout);
        queue.idleTimeout = null;
    }

    const songToPlay = queue.currentSong;
    const safeTitle = (songToPlay.title || "song")
        .replace(/[^\w\s.-]/gi, "")
        .substring(0, 100);
    const tempFileName = `${Date.now()}_${safeTitle}.mp3`;
    const tempFilePath = path.join(AUDIO_CACHE_DIR, tempFileName);
    songToPlay.filePathToDelete = tempFilePath;

    console.log(
        `[${guildId}] Attempting to download: ${songToPlay.title} to ${tempFilePath}`
    );

    try {
        const sourceForDownload = songToPlay.urlToDownload || songToPlay.url;
        if (!sourceForDownload) {
            throw new Error("Missing URL or Video ID for download.");
        }

        const downloadCommand = `yt-dlp -x --audio-format mp3 --audio-quality ${YT_DLP_AUDIO_QUALITY} -o "${tempFilePath}" "${sourceForDownload}"`;
        console.log(`[${guildId}] Executing yt-dlp: ${downloadCommand}`);

        const downloadProcess = exec(downloadCommand);
        let ytdlpStderr = "";
        downloadProcess.stderr.on("data", (data) => {
            ytdlpStderr += data.toString();
        });

        await new Promise((resolve, reject) => {
            downloadProcess.on("close", (code) => {
                if (code === 0) {
                    console.log(
                        `[${guildId}] Successfully downloaded: ${songToPlay.title}`
                    );
                    resolve();
                } else {
                    console.error(
                        `[${guildId}] yt-dlp failed for ${songToPlay.title}. Code: ${code}. Stderr:\n${ytdlpStderr}`
                    );
                    reject(
                        new Error(
                            `yt-dlp failed (code ${code}). ${ytdlpStderr.substring(
                                0,
                                100
                            )}`
                        )
                    );
                }
            });
            downloadProcess.on("error", (err) => {
                console.error(
                    `[${guildId}] Failed to start yt-dlp process for ${songToPlay.title}:`,
                    err
                );
                reject(err);
            });
        });

        console.log(
            `[${guildId}] Download complete. Creating AudioResource from: ${tempFilePath}`
        );
        const resource = createAudioResource(tempFilePath, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true,
            metadata: songToPlay,
        });
        resource.volume.setVolume(queue.volume || 1);

        if (
            !queue.connection.state.subscription ||
            queue.connection.state.subscription.player !== queue.audioPlayer
        ) {
            queue.connection.subscribe(queue.audioPlayer);
        }

        queue.audioPlayer.play(resource);
        queue.isPlaying = true;
        console.log(
            `[${guildId}] audioPlayer.play() called for ${songToPlay.title}.`
        );
        await updateNowPlayingMessage(guildId); // Update to "Now Playing" (statusMessage will be null)
    } catch (error) {
        console.error(
            `[${guildId}] CRITICAL ERROR during download/playback for ${
                songToPlay?.title || "Unknown Song"
            }:`,
            error
        );
        await updateNowPlayingMessage(
            guildId,
            `❌ เกิดข้อผิดพลาด: ${
                error.message
                    ? error.message.substring(0, 100)
                    : "Unknown error"
            }. กำลังข้าม...`
        );

        if (fs.existsSync(tempFilePath)) {
            fs.unlink(tempFilePath, (err) => {
                if (err)
                    console.error(
                        `[${guildId}] Error deleting incomplete file ${tempFilePath}:`,
                        err
                    );
                else
                    console.log(
                        `[${guildId}] Deleted incomplete file ${tempFilePath}.`
                    );
            });
        }
        playNextSong(guildId);
    }
}

// --- Function to centralize Now Playing Message updates ---
async function updateNowPlayingMessage(guildId, statusMessage = null) {
    const queue = guildQueues.get(guildId);
    if (!queue || !queue.textChannel) {
        console.log(
            `[${guildId}] updateNowPlayingMessage: No queue or textChannel, cannot update.`
        );
        return;
    }

    const embed = createMusicEmbed(guildId, statusMessage);
    const components = createMusicComponents(guildId);

    if (!embed) {
        if (queue.nowPlayingMessage && !queue.nowPlayingMessage.deleted) {
            await queue.nowPlayingMessage
                .delete()
                .catch((e) =>
                    console.error("Error deleting NPM when queue is gone", e)
                );
            queue.nowPlayingMessage = null;
        }
        return;
    }

    if (queue.nowPlayingMessage && !queue.nowPlayingMessage.deleted) {
        await queue.nowPlayingMessage
            .edit({ content: "", embeds: [embed], components })
            .catch(async (e) => {
                console.error(
                    `[${guildId}] Error editing existing nowPlayingMessage (ID: ${queue.nowPlayingMessage.id}):`,
                    e.message
                );
                if (e.code === 10008) {
                    // Unknown Message
                    console.log(
                        `[${guildId}] nowPlayingMessage was deleted by user or Discord. Sending a new one.`
                    );
                    queue.nowPlayingMessage = null;
                    await updateNowPlayingMessage(guildId, statusMessage);
                }
            });
    } else {
        console.log(
            `[${guildId}] Sending new nowPlayingMessage. Status: ${
                statusMessage || "Default (Now Playing/Queue Info)"
            }`
        );
        try {
            const newMessage = await queue.textChannel.send({
                content: "",
                embeds: [embed],
                components,
            });
            queue.nowPlayingMessage = newMessage;
        } catch (e) {
            console.error(
                `[${guildId}] Error sending new nowPlayingMessage:`,
                e.message
            );
            queue.nowPlayingMessage = null;
        }
    }
}

// --- handleMusicRequest (Ensure videoId and sourceType are correctly stored) ---
async function handleMusicRequest(message, query) {
    const guildId = message.guildId;
    const member = message.member;
    const textChannel = message.channel;

    if (!member.voice.channel) {
        return textChannel.send("คุณต้องอยู่ในช่องเสียงเพื่อเล่นเพลง!");
    }
    const voiceChannel = member.voice.channel;
    let queue = guildQueues.get(guildId);
    let connection = getVoiceConnection(guildId);

    if (
        !queue ||
        !connection ||
        connection.state.status === VoiceConnectionStatus.Destroyed
    ) {
        console.log(
            `[${guildId}] No queue/connection, creating new one for channel ${voiceChannel.name}`
        );
        const audioPlayer = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
        });

        audioPlayer.on(AudioPlayerStatus.Idle, (oldState, newState) => {
            console.log(
                `[${guildId}] Player Idle (from ${oldState.status}). Handling next song or cleanup.`
            );
            const q = guildQueues.get(guildId);
            if (q && q.currentSong && q.currentSong.filePathToDelete) {
                if (fs.existsSync(q.currentSong.filePathToDelete)) {
                    fs.unlink(q.currentSong.filePathToDelete, (err) => {
                        if (err)
                            console.error(
                                `[${guildId}] Error deleting played file ${q.currentSong.filePathToDelete}:`,
                                err
                            );
                        else
                            console.log(
                                `[${guildId}] Deleted played file ${q.currentSong.filePathToDelete}`
                            );
                    });
                }
                q.currentSong.filePathToDelete = null;
            }
            playNextSong(guildId);
        });

        audioPlayer.on("error", (error) => {
            console.error(`[${guildId}] Player Error:`, error);
            updateNowPlayingMessage(
                guildId,
                `❌ Player Error: ${error.message.substring(
                    0,
                    100
                )}. Trying to skip.`
            );
            playNextSong(guildId);
        });
        audioPlayer.on("debug", (msg) =>
            console.log(`[${guildId}] Player DEBUG: ${msg}`)
        );
        audioPlayer.on(AudioPlayerStatus.Buffering, (o) =>
            console.log(`[${guildId}] Player [${o.status} -> Buffering]`)
        );

        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
        });
        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`[${guildId}] VC Destroyed. Cleaning up.`);
            const q = guildQueues.get(guildId);
            if (q) {
                if (q.nowPlayingMessage && !q.nowPlayingMessage.deleted)
                    q.nowPlayingMessage
                        .delete()
                        .catch((e) =>
                            console.error("Error deleting NPM on destroy", e)
                        );
                if (q.idleTimeout) clearTimeout(q.idleTimeout);
                if (q.audioPlayer) q.audioPlayer.stop(true);
                if (
                    q.currentSong &&
                    q.currentSong.filePathToDelete &&
                    fs.existsSync(q.currentSong.filePathToDelete)
                ) {
                    fs.unlinkSync(q.currentSong.filePathToDelete);
                }
                q.songs.forEach((song) => {
                    if (
                        song.filePathToDelete &&
                        fs.existsSync(song.filePathToDelete)
                    )
                        fs.unlinkSync(song.filePathToDelete);
                });
            }
            guildQueues.delete(guildId);
        });
        connection.on(
            VoiceConnectionStatus.Disconnected,
            async (oldState, newState) => {
                console.warn(
                    `[${guildId}] VC Disconnected. Reason: ${newState?.reason}, Code: ${newState?.closeCode}`
                );
                if (
                    newState.reason === VoiceConnectionStatus.WebSocketClose &&
                    newState.closeCode === 4014
                ) {
                    console.log(
                        `[${guildId}] VC closed by Discord (4014), not attempting to reconnect.`
                    );
                    await updateNowPlayingMessage(
                        guildId,
                        "⚠️ การเชื่อมต่อเสียงถูกตัด (อาจมีการย้ายช่อง) โปรดลองอีกครั้ง"
                    );
                } else {
                    try {
                        await Promise.race([
                            entersState(
                                connection,
                                VoiceConnectionStatus.Signalling,
                                5_000
                            ),
                            entersState(
                                connection,
                                VoiceConnectionStatus.Connecting,
                                5_000
                            ),
                        ]);
                    } catch (error) {
                        if (
                            connection.state.status !==
                            VoiceConnectionStatus.Destroyed
                        )
                            connection.destroy();
                    }
                }
            }
        );

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        } catch (error) {
            if (connection.state.status !== VoiceConnectionStatus.Destroyed)
                connection.destroy();
            return textChannel.send(
                `ไม่สามารถเชื่อมต่อช่องเสียงได้: ${error.message.substring(
                    0,
                    100
                )}`
            );
        }

        queue = {
            voiceChannel,
            textChannel,
            connection,
            audioPlayer,
            songs: [],
            currentSong: null,
            volume: 1,
            bass: 0,
            isPlaying: false,
            nowPlayingMessage: null,
            idleTimeout: null,
            loop: "none",
        };
        guildQueues.set(guildId, queue);
        if (fs.existsSync(WELCOME_SOUND_PATH))
            await playLocalSound(guildId, WELCOME_SOUND_PATH);
        if (
            connection.state.status === VoiceConnectionStatus.Ready &&
            queue.audioPlayer
        ) {
            try {
                if (
                    !connection.state.subscription ||
                    connection.state.subscription.player !== queue.audioPlayer
                ) {
                    connection.subscribe(queue.audioPlayer);
                }
            } catch (subError) {
                console.error(
                    `[${guildId}] Error subscribing main player after welcome:`,
                    subError
                );
            }
        }
    } else {
        if (queue.voiceChannel.id !== voiceChannel.id) {
            return textChannel.send(
                `ฉันกำลังเล่นเพลงอยู่ใน ${queue.voiceChannel.name}!`
            );
        }
        queue.textChannel = textChannel;
    }

    await updateNowPlayingMessage(
        guildId,
        `🔎 กำลังประมวลผลลิงก์: ${query.substring(0, 50)}...`
    );

    try {
        const validation = await play.validate(query);
        let newSongs = [];
        let finalFeedbackStatus = "";

        if (validation === "yt_playlist") {
            const playlist = await play.playlist_info(query, {
                incomplete: true,
            });
            if (!playlist || !playlist.videos || playlist.videos.length === 0)
                throw new Error("ไม่สามารถดึงข้อมูลเพลย์ลิสต์");
            const videos = playlist.videos;
            newSongs = videos
                .map((video) => {
                    if (!video || !video.url || !video.id) return null;
                    const thumbnails =
                        video.thumbnails?.sort((a, b) => b.width - a.width) ||
                        [];
                    return {
                        sourceType: "yt_video",
                        videoId: video.id,
                        title: video.title || "YT Video",
                        url: video.url,
                        urlToDownload: video.url,
                        thumbnail: thumbnails[0]?.url || BOT_LOGO_URL,
                        durationRaw: video.durationRaw,
                        durationFormatted: video.durationRaw,
                        durationSec: video.durationInSec,
                        requestedBy: member.id,
                    };
                })
                .filter((s) => s !== null)
                .slice(0, 50);
            if (newSongs.length === 0 && videos.length > 0)
                throw new Error("ไม่สามารถดึงข้อมูลเพลงในเพลย์ลิสต์");
            finalFeedbackStatus = `✅ เพิ่ม **${newSongs.length}** เพลงจากเพลย์ลิสต์ **${playlist.title}**`;
        } else if (
            validation === "yt_video" ||
            validation === "sp_track" ||
            validation === "so_track"
        ) {
            const songInfo = await play.video_info(query);
            if (
                !songInfo ||
                !songInfo.video_details ||
                !songInfo.video_details.url
            )
                throw new Error("ไม่สามารถดึงข้อมูลเพลง");
            const details = songInfo.video_details;
            const thumbnails =
                details.thumbnails?.sort((a, b) => b.width - a.width) || [];
            newSongs.push({
                sourceType: details.type === "video" ? "yt_video" : validation,
                videoId: details.id || null,
                title: details.title || "Unknown Track",
                url: details.url,
                urlToDownload: details.url,
                thumbnail: thumbnails[0]?.url || BOT_LOGO_URL,
                durationRaw: details.durationRaw,
                durationFormatted: details.durationRaw,
                durationSec: details.durationInSec,
                requestedBy: member.id,
            });
            finalFeedbackStatus = `✅ เพิ่ม **${newSongs[0].title}** เข้าคิวแล้ว`;
        } else {
            const searchResults = await play.search(query, {
                limit: 1,
                source: { youtube: "video" },
            });
            if (
                !searchResults ||
                searchResults.length === 0 ||
                !searchResults[0].url ||
                !searchResults[0].id
            )
                throw new Error(`ไม่พบผลการค้นหาสำหรับ "${query}"`);
            const details = searchResults[0];
            const thumbnails =
                details.thumbnails?.sort((a, b) => b.width - a.width) || [];
            newSongs.push({
                sourceType: "yt_video",
                videoId: details.id,
                title: details.title || "YT Search Result",
                url: details.url,
                urlToDownload: details.url,
                thumbnail: thumbnails[0]?.url || BOT_LOGO_URL,
                durationRaw: details.durationRaw,
                durationFormatted: details.durationRaw,
                durationSec: details.durationInSec,
                requestedBy: member.id,
            });
            finalFeedbackStatus = `✅ ค้นพบและเพิ่ม: **${newSongs[0].title}**`;
        }

        if (newSongs.length > 0) {
            queue.songs.push(...newSongs);
            await updateNowPlayingMessage(guildId, finalFeedbackStatus);
            if (!queue.isPlaying && !queue.currentSong) {
                playNextSong(guildId);
            }
        } else {
            await updateNowPlayingMessage(
                guildId,
                "ไม่พบเพลงที่สามารถเพิ่มได้"
            );
        }
    } catch (error) {
        console.error(
            `[${guildId}] Error in handleMusicRequest for "${query}":`,
            error
        );
        await updateNowPlayingMessage(
            guildId,
            `❌ อ๊ะ! เกิดข้อผิดพลาด: ${
                error.message
                    ? error.message.substring(0, 1000)
                    : "Unknown error"
            }`
        );
    }
}

// --- Client Event Handlers ---
client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}! Bot Name: ${BOT_NAME}`);
    client.user.setActivity("เพลงจากลิงก์ 🎶 (ดาวน์โหลด)", {
        type: "LISTENING",
    });
    console.log(
        "บอทพร้อมใช้งานแล้ว (V2.3.3 - Ephemeral Flags Fix) รอรับลิงก์ในช่องที่กำหนด"
    );
});

client.on("interactionCreate", async (interaction) => {
    const guildId = interaction.guildId;
    let queue = guildQueues.get(guildId);

    if (!interaction.guild) return;

    if (interaction.isButton()) {
        if (!queue) {
            await interaction.reply({
                content:
                    "เซสชันเพลงนี้สิ้นสุดแล้ว หรือเกิดข้อผิดพลาด โปรดวางลิงก์เพื่อเริ่มใหม่",
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }
        if (queue.voiceChannel.id !== interaction.member.voice.channel?.id) {
            await interaction.reply({
                content: `คุณต้องอยู่ในช่องเสียงเดียวกับฉัน (${queue.voiceChannel.name})!`,
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        let shouldUpdateNPM = true;

        switch (interaction.customId) {
            case "music_play_pause":
                if (
                    queue.audioPlayer?.state?.status ===
                    AudioPlayerStatus.Playing
                ) {
                    queue.audioPlayer.pause();
                    queue.isPlaying = false;
                } else if (
                    queue.audioPlayer?.state?.status ===
                    AudioPlayerStatus.Paused
                ) {
                    queue.audioPlayer.unpause();
                    queue.isPlaying = true;
                } else if (queue.currentSong || queue.songs.length > 0) {
                    if (!queue.currentSong && queue.songs.length > 0)
                        playNextSong(guildId);
                    else if (
                        queue.currentSong &&
                        queue.audioPlayer?.state?.status ===
                            AudioPlayerStatus.Idle
                    )
                        playNextSong(guildId);
                    queue.isPlaying = true;
                }
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                break;
            case "music_skip":
                if (queue.currentSong || queue.songs.length > 0) {
                    if (queue.audioPlayer) queue.audioPlayer.stop();
                    else playNextSong(guildId);
                }
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                break;
            case "music_stop":
                queue.songs = [];
                queue.currentSong = null;
                queue.isPlaying = false;
                if (queue.audioPlayer) queue.audioPlayer.stop(true);
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                await updateNowPlayingMessage(
                    guildId,
                    "⏹️ หยุดเล่นเพลงและล้างคิวแล้ว"
                );
                break;
            case "music_replay":
                if (queue.currentSong) {
                    const songToReplay = {
                        ...queue.currentSong,
                        filePathToDelete: null,
                    };
                    queue.songs.unshift(songToReplay);
                    if (queue.audioPlayer) queue.audioPlayer.stop();
                }
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                break;
            case "music_shuffle_queue":
                if (queue.songs.length > 1) {
                    for (let i = queue.songs.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [queue.songs[i], queue.songs[j]] = [
                            queue.songs[j],
                            queue.songs[i],
                        ];
                    }
                }
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                break;
            case "music_clear_queue":
                queue.songs = [];
                await interaction
                    .deferUpdate()
                    .catch((e) => console.error("defer error", e));
                break;
            case "music_info":
                const infoEmbed = new EmbedBuilder()
                    .setColor(PINK_PASTEL_COLOR)
                    .setTitle(`${BOT_NAME} Info`)
                    .setThumbnail(BOT_LOGO_URL)
                    .setDescription("บอทเพลง (โหมดดาวน์โหลดก่อนเล่น)!")
                    .addFields(
                        {
                            name: "เวอร์ชัน",
                            value: "2.3.3 (Ephemeral Flags Fix)",
                            inline: true,
                        },
                        {
                            name: "Library",
                            value: `discord.js ${
                                require("discord.js").version
                            }`,
                            inline: true,
                        },
                        {
                            name: "โหมด",
                            value: "วางลิงก์เท่านั้น",
                            inline: true,
                        }
                    )
                    .setTimestamp();
                if (queue && queue.currentSong) {
                    infoEmbed.addFields({
                        name: "กำลังเล่น",
                        value: `[${queue.currentSong.title}](${queue.currentSong.url})`,
                    });
                }
                await interaction
                    .reply({
                        embeds: [infoEmbed],
                        flags: [MessageFlags.Ephemeral],
                    })
                    .catch((e) => console.error("Info reply error:", e));
                shouldUpdateNPM = false;
                break;
            case "music_leave":
                if (
                    queue.connection &&
                    queue.connection.state.status !==
                        VoiceConnectionStatus.Destroyed
                ) {
                    if (queue.idleTimeout) clearTimeout(queue.idleTimeout);
                    queue.connection.destroy();
                    await interaction
                        .reply({
                            content: "👋 ออกจากช่องเสียงแล้ว",
                            flags: [MessageFlags.Ephemeral],
                        })
                        .catch((e) => console.error("Leave reply error:", e));
                } else {
                    await interaction
                        .reply({
                            content:
                                "ฉันไม่ได้อยู่ในช่องเสียง หรือการเชื่อมต่อถูกทำลายไปแล้ว",
                            flags: [MessageFlags.Ephemeral],
                        })
                        .catch((e) => console.error("Leave reply error:", e));
                }
                shouldUpdateNPM = false;
                break;
            case "music_sound_settings":
                if (!queue) {
                    await interaction.reply({
                        content: "ไม่มีเซสชันเพลงที่กำลังทำงาน",
                        flags: [MessageFlags.Ephemeral],
                    });
                    return;
                }
                const modal = new ModalBuilder()
                    .setCustomId("sound_settings_modal")
                    .setTitle("ตั้งค่าเสียง");
                const volumeInput = new TextInputBuilder()
                    .setCustomId("volume_input")
                    .setLabel("ระดับเสียง (0-200%) Default: 100")
                    .setStyle(TextInputStyle.Short)
                    .setValue(Math.round((queue.volume || 1) * 100).toString())
                    .setRequired(true);

                const bassInput = new TextInputBuilder()
                    .setCustomId("bass_input")
                    .setLabel("Bass Boost (0-20, UI เท่านั้น ยังไม่มีผล)")
                    .setStyle(TextInputStyle.Short)
                    .setValue((queue.bass || 0).toString())
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(volumeInput),
                    new ActionRowBuilder().addComponents(bassInput)
                );
                await interaction
                    .showModal(modal)
                    .catch((err) =>
                        console.error(`[${guildId}] Error showing modal:`, err)
                    );
                shouldUpdateNPM = false;
                break;
        }

        if (
            shouldUpdateNPM &&
            queue.nowPlayingMessage &&
            !queue.nowPlayingMessage.deleted
        ) {
            await updateNowPlayingMessage(guildId);
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "music_select_from_queue") {
            if (!queue) {
                await interaction.reply({
                    content: "เซสชันเพลงนี้สิ้นสุดแล้ว",
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            if (
                queue.voiceChannel.id !== interaction.member.voice.channel?.id
            ) {
                await interaction.reply({
                    content: `คุณต้องอยู่ในช่องเสียงเดียวกับฉัน (${queue.voiceChannel.name})!`,
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            const selectedSongIndex = parseInt(
                interaction.values[0].replace("select_song_", "")
            );
            if (
                isNaN(selectedSongIndex) ||
                selectedSongIndex < 0 ||
                selectedSongIndex >= queue.songs.length
            ) {
                await interaction.reply({
                    content: "การเลือกเพลงไม่ถูกต้อง",
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            await interaction.deferUpdate().catch((e) => console.error(e));
            const selectedSong = queue.songs.splice(selectedSongIndex, 1)[0];
            if (selectedSong) {
                if (queue.currentSong)
                    queue.songs.unshift({
                        ...queue.currentSong,
                        filePathToDelete: null,
                    });
                queue.songs.unshift(selectedSong);
                if (queue.audioPlayer) queue.audioPlayer.stop();
                else playNextSong(guildId);
            }
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "sound_settings_modal") {
            if (!queue) {
                await interaction.reply({
                    content: "เซสชันเพลงสิ้นสุดแล้ว",
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            const volumePercent = parseInt(
                interaction.fields.getTextInputValue("volume_input")
            );
            const bassLevel = parseInt(
                interaction.fields.getTextInputValue("bass_input") || "0"
            );
            let feedbackParts = [];
            if (
                !isNaN(volumePercent) &&
                volumePercent >= 0 &&
                volumePercent <= 200
            ) {
                queue.volume = volumePercent / 100;
                if (queue.audioPlayer?.state.resource?.volume)
                    queue.audioPlayer.state.resource.volume.setVolume(
                        queue.volume
                    );
                feedbackParts.push(`🔊 ระดับเสียงตั้งเป็น ${volumePercent}%.`);
            } else feedbackParts.push(`⚠️ ระดับเสียงไม่ถูกต้อง (0-200).`);
            if (!isNaN(bassLevel) && bassLevel >= 0 && bassLevel <= 20) {
                queue.bass = bassLevel;
                feedbackParts.push(
                    `🎶 Bass Boost (UI) ตั้งเป็น ${bassLevel}. (ยังไม่มีผลต่อเสียงจริง)`
                );
            } else feedbackParts.push(`⚠️ ระดับ Bass (UI) ไม่ถูกต้อง (0-20).`);
            await interaction
                .reply({
                    content: feedbackParts.join("\n"),
                    flags: [MessageFlags.Ephemeral],
                })
                .catch((e) => console.error(e));
            await updateNowPlayingMessage(guildId);
        }
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (
        message.channel.id === ALLOWED_MUSIC_CHANNEL_ID &&
        isValidHttpUrl(message.content)
    ) {
        console.log(
            `[${message.guildId}] Link pasted in #${message.channel.name} by ${message.author.tag}: ${message.content}`
        );
        const originalMessage = message;
        await handleMusicRequest(message, message.content);
        if (originalMessage.deletable) {
            await originalMessage
                .delete()
                .catch((err) =>
                    console.error(
                        `[${message.guildId}] Failed to delete user's link message:`,
                        err
                    )
                );
        }
        return;
    }
});

client.login(process.env.DISCORD_TOKEN);

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
});
process.on("uncaughtException", (error, origin) => {
    console.error(`Uncaught Exception: ${error.message} at ${origin}`);
    console.error(error.stack);
});
