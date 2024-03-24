import 'server-only';

import { createAI, createStreamableUI, getMutableAIState } from 'ai/rsc';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';



import {
  spinner,
  BotCard,
  BotMessage,
  SystemMessage,
  Stock,
  Purchase,
  Stocks,
  Events,
  Coins
} from '@/components/llm-stocks';

import { CodeBlock } from '@/components/llm-stocks/code';

import {
  runAsyncFnWithoutBlocking,
  sleep,
  formatNumber,
  runOpenAICompletion,
} from '@/lib/utils';
import { z } from 'zod';
import { StockSkeleton } from '@/components/llm-stocks/stock-skeleton';
import { EventsSkeleton } from '@/components/llm-stocks/events-skeleton';
import { StocksSkeleton } from '@/components/llm-stocks/stocks-skeleton';

const llm = "anthropic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '', // defaults to process.env["ANTHROPIC_API_KEY"]
});

function processResponse(total_response, reply) {
  const elements = []; // This will hold both strings and React components
  let lastIndex = 0; // Tracks the last index after each processed segment
  let inCodeBlock = false; // Flag to track if we are currently in a code block
  let codeBlockStartIndex = 0; // To remember where the current code block started

  // Updated regex to find code block starts and ends
  const startRegex = /(```|´´´)(\w+)?\s*/g;
  let match;
  while ((match = startRegex.exec(total_response)) !== null) {
    if (!inCodeBlock) {
      // We found the start of a code block
      inCodeBlock = true;
      codeBlockStartIndex = match.index + match[0].length; // Adjust start index to exclude the delimiter and optional language identifier
      const textBeforeCode = total_response.substring(lastIndex, match.index);
      if (textBeforeCode) elements.push(textBeforeCode);
      lastIndex = startRegex.lastIndex; // Update lastIndex to the end of the current match
    } else {
      // We found the end of a code block
      inCodeBlock = false;
      const codeBlockContent = total_response.substring(codeBlockStartIndex, match.index);
      elements.push(<CodeBlock code={codeBlockContent.trim()} />);
      lastIndex = startRegex.lastIndex; // Update lastIndex to the end of the current match
    }
  }

  if (inCodeBlock) {
    // If we're still in a code block and there's no closing ```, consider everything till now as code
    const ongoingCodeBlockContent = total_response.substring(codeBlockStartIndex);
    elements.push(<CodeBlock code={ongoingCodeBlockContent.trim()} />);
  } else if (lastIndex < total_response.length) {
    // Add any remaining text after the last code block or if no code blocks are present
    const remainingText = total_response.substring(lastIndex);
    if (remainingText) elements.push(remainingText);
  }

  // Now `elements` contains a mix of strings and React components
  // Update your reply to use this mixed content
  if (elements.length > 0) {
    reply.update(<BotMessage>{elements}</BotMessage>);
  } else {
    // If there are no elements (which should be rare), just show the content as is
    reply.update(<BotMessage>{total_response}</BotMessage>);
  }
}

async function submitUserMessage(content: string) {
  'use server';
  const reply = createStreamableUI(
    <BotMessage className="items-center">{spinner}</BotMessage>
  );
  let total_response = '';
  const aiState = getMutableAIState<typeof AI>();
  aiState.update([
    ...aiState.get(),
    {
      role: 'user',
      content,
    },
  ]);
  let messages = aiState.get();
  await runAsyncFnWithoutBlocking(async () => {
    if (llm === 'anthropic') {
      const stream = anthropic.messages.stream({
        messages: messages,
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
      }).on('text', (response) => {
        total_response = total_response + response;
        processResponse(total_response, reply);
      });
      const message = await stream.finalMessage();
      content = message.content[0].text;
      reply.done();
      aiState.done([
        ...aiState.get(),
        {
          role: 'assistant',
          content,
        },
      ]);
    } else if (llm === 'openai') {
      const completion = runOpenAICompletion(openai, {
        model: 'gpt-3.5-turbo',
        stream: true,
        messages: [
          {
            role: 'system',
            content: `Du bist ein hilfreicher Assistent`,
          },
          ...aiState.get().map((info: any) => ({
            role: info.role,
            content: info.content,
            name: info.name,
          })),
        ],
        functions: [
          {
            name: 'get_events',
            description:
              'List funny imaginary events between user highlighted dates that describe stock activity.',
            parameters: z.object({
              events: z.array(
                z.object({
                  date: z
                    .string()
                    .describe('The date of the event, in ISO-8601 format'),
                  headline: z.string().describe('The headline of the event'),
                  description: z.string().describe('The description of the event'),
                }),
              ),
            }),
          },
        ],
        temperature: 0,
      });

      completion.onTextContent((content: string, isFinal: boolean) => {
        reply.update(<BotMessage>{content}</BotMessage>);
        if (isFinal) {
          reply.done();
          aiState.done([...aiState.get(), { role: 'assistant', content }]);
        }
      });

      completion.onFunctionCall('get_events', async ({ events }) => {
        reply.update(
          <BotCard>
            <EventsSkeleton />
          </BotCard>,
        );

        await sleep(1000);

        reply.done(
          <BotCard>
            <Events events={events} />
          </BotCard>,
        );

        aiState.done([
          ...aiState.get(),
          {
            role: 'function',
            name: 'get_events',
            content: JSON.stringify(events),
          },
        ]);
      });

    }
  });
  return {
    id: Date.now(),
    display: reply.value,
  };
}

const initialAIState: {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  id?: string;
  name?: string;
}[] = [];

const initialUIState: {
  id: number;
  display: React.ReactNode;
}[] = [];

export const AI = createAI({
  actions: {
    submitUserMessage,
  },
  initialUIState,
  initialAIState,
});
