import { OpenAI } from "openai";
// import { ChatCompletionMessage } from "OpenAi/resources/index.mjs";
import {
    MessageNewEvent,
    CallEndedEvent,
    CallTranscriptionReadyEvent,
    CallRecordingReadyEvent,
    CallSessionParticipantLeftEvent,
    CallSessionStartedEvent,
} from "@stream-io/node-sdk"
import { generateAvatarUri } from "@/lib/avatar";
import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";
import { streamChat } from "@/lib/stream-chat";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function verifySignatureWithSDK(body: string, signature: string): boolean {
    return streamVideo.verifyWebhook(body, signature);
};

export async function POST(req: NextRequest) {
    const signature = req.headers.get("x-signature");
    const apiKey = req.headers.get("x-api-key");

    if (!signature || !apiKey) {
        return NextResponse.json(
            { error: "Missing signature or API key" },
            { status: 400 }
        );
    }

    const body = await req.text();

    if (!verifySignatureWithSDK(body, signature)) {
        return NextResponse.json({ error: "Invalid signature " }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON " }, { status: 400 });
    }

    const eventType = (payload as Record<string, unknown>)?.type;

    if (eventType === "call.session_started") {
        const event = payload as CallSessionStartedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId " }, { status: 400 });
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(
                and(
                    eq(meetings.id, meetingId),
                    not(eq(meetings.status, "completed")),
                    not(eq(meetings.status, "active")),
                    not(eq(meetings.status, "cancelled")),
                    not(eq(meetings.status, "processing")),
                )
            );

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found " }, { status: 404 })
        }

        await db
            .update(meetings)
            .set({
                status: "active",
                startedAt: new Date(),
            })
            .where(eq(meetings.id, existingMeeting.id))

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found " }, { status: 404 })
        }

        const call = streamVideo.video.call("default", meetingId);
        const realtimeClient = await streamVideo.video.connectOpenAi({
            call,
            openAiApiKey: process.env.OPENAI_API_KEY!,
            agentUserId: existingAgent.id,
        });

        realtimeClient.updateSession({
            instructions: existingAgent.instructions,
        });
    } else if (eventType === "call.session_participant_left") {
        const event = payload as CallSessionParticipantLeftEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
        }

        const call = streamVideo.video.call("default", meetingId);
        await call.end();
    } else if (eventType === "call.session_ended") {
        const event = payload as CallEndedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
        }

        await db
            .update(meetings)
            .set({
                status: "processing",
                startedAt: new Date(),
            })
            .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));

    } else if (eventType === "call.transcription_ready") {
        const event = payload as CallTranscriptionReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
        }

        if (!event.call_transcription?.url) {
            console.error(`No transcript URL in transcription ready event for meeting ${meetingId}`);
            return NextResponse.json({ error: "Missing transcript URL" }, { status: 400 });
        }

        console.log(`Updating meeting ${meetingId} with transcript URL: ${event.call_transcription.url}`);

        const [updatedMeeting] = await db
            .update(meetings)
            .set({
                transcriptUrl: event.call_transcription.url,
            })
            .where(eq(meetings.id, meetingId))
            .returning();

        if (!updatedMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        if (!updatedMeeting.transcriptUrl) {
            console.error(`Failed to update transcript URL for meeting ${meetingId}`);
            return NextResponse.json({ error: "Failed to update transcript URL" }, { status: 500 });
        }

        console.log(`Sending Inngest event for meeting ${meetingId} with transcript URL: ${updatedMeeting.transcriptUrl}`);

        await inngest.send({
            name: "meetings/processing",
            data: {
                meetingId: updatedMeeting.id,
                transcriptUrl: updatedMeeting.transcriptUrl,
            }
        })

    } else if (eventType === "call.recording_ready") {
        const event = payload as CallRecordingReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        await db
            .update(meetings)
            .set({
                recordingUrl: event.call_recording.url,
            })
            .where(eq(meetings.id, meetingId));
    } else if (eventType === "message.new") {
        const event = payload as MessageNewEvent;

        const userId = event.user?.id;
        const channelId = event.channel_id;
        const text = event.message?.text;

        if (!userId || !channelId || !text) {
            return NextResponse.json(
                { error: "Missing require fields" },
                { status: 400 }
            );
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }
        if (userId !== existingAgent.id) {
            const instructions = `
      You are an AI assistant helping the user revisit a recently completed meeting.
      Below is a summary of the meeting, generated from the transcript:
      
      ${existingMeeting.summary}
      
      The following are your original instructions from the live meeting assistant. Please continue to follow these behavioral guidelines as you assist the user:
      
      ${existingAgent.instructions}
      
      The user may ask questions about the meeting, request clarifications, or ask for follow-up actions.
      Always base your responses on the meeting summary above.
      
      You also have access to the recent conversation history between you and the user. Use the context of previous messages to provide relevant, coherent, and helpful responses. If the user's question refers to something discussed earlier, make sure to take that into account and maintain continuity in the conversation.
      
      If the summary does not contain enough information to answer a question, politely let the user know.
      
      Be concise, helpful, and focus on providing accurate information from the meeting and the ongoing conversation.
      `;

            const channel = streamChat.channel("messaging", channelId);
            await channel.watch();

            const previousMessages = channel.state.messages
                .slice(-5)
                .filter((msg) => msg.text && msg.text.trim() !== "")
                .map((message) => ({
                    role: message.user?.id === existingAgent.id ? "assistant" as const : "user" as const,
                    content: message.text || "",
                }));

            try {
                const GPTResponse = await openaiClient.chat.completions.create({
                    messages: [
                        { role: "system" as const, content: instructions },
                        ...previousMessages,
                        { role: "user" as const, content: text }
                    ],
                    model: "gpt-4o",
                });

                const GPTResponseText = GPTResponse.choices[0].message.content;

                if (!GPTResponseText) {
                    return NextResponse.json({ error: "No response from OpenAI" }, { status: 500 });
                }

                const avatarUrl = generateAvatarUri({
                    seed: existingAgent.name,
                    variant: "botttsNeutral"
                });

                streamChat.upsertUser({
                    id: existingAgent.id,
                    name: existingAgent.name,
                    image: avatarUrl,
                });

                channel.sendMessage({
                    text: GPTResponseText,
                    user: {
                        id: existingAgent.id,
                        name: existingAgent.name,
                        image: avatarUrl,
                    },
                });
            } catch (error: unknown) {
                console.error('OpenAI API Error:', error);
                
                const openaiError = error as { status?: number; message?: string };
                
                if (openaiError.status === 429) {
                    // Handle quota exceeded error
                    const fallbackMessage = "I'm currently experiencing high demand and cannot respond right now. Please try again later or contact support if this persists.";
                    
                    const avatarUrl = generateAvatarUri({
                        seed: existingAgent.name,
                        variant: "botttsNeutral"
                    });

                    streamChat.upsertUser({
                        id: existingAgent.id,
                        name: existingAgent.name,
                        image: avatarUrl,
                    });

                    channel.sendMessage({
                        text: fallbackMessage,
                        user: {
                            id: existingAgent.id,
                            name: existingAgent.name,
                            image: avatarUrl,
                        },
                    });
                } else {
                    // Handle other OpenAI errors
                    return NextResponse.json({
                        error: "OpenAI service temporarily unavailable",
                        details: openaiError.message || "Unknown error"
                    }, { status: 503 });
                }
            }
        }
    }

    return NextResponse.json({ status: "ok" });
}


