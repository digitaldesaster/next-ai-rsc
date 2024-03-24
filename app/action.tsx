import 'server-only';

import { createAI, createStreamableUI, getMutableAIState } from 'ai/rsc';
import OpenAI from 'openai';

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

async function submitUserMessage(content: string) {
  'use server';

  const aiState = getMutableAIState<typeof AI>();
  aiState.update([
    ...aiState.get(),
    {
      role: 'user',
      content,
    },
  ]);

  const reply = createStreamableUI(
    <BotMessage className="items-center">{spinner}</BotMessage>,
  );

  const completion = runOpenAICompletion(openai, {
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: [
      {
        role: 'system',
        content: `\
Du bist ein hilfreicher Assistent.
Wenn ein Nutzer nach Ereignissen fragt, benutze \`get_events\`.
Wenn ein Nutzer nach Preisen für Crypto-Währungen fragt, benutze \`get_prices\`.
`,
      },
      ...aiState.get().map((info: any) => ({
        role: info.role,
        content: info.content,
        name: info.name,
      })),
    ],
    functions: [
      {
        name: 'get_prices',
        description:
          'Benutze diese Funktion um Preise zu Crypto-Währungen zu erhalten',
        parameters: z.object({
          coins: z.array(
            z.object({
              name: z.string().describe('Der Name der Crypto-Währung zum Beispiel:Bitcoin'),
              ticker: z.string().describe('Der Ticker der Cryptowährung zum Beispiel:BTC'),
            }),
          ),
        }),
      },
      {
        name: 'get_events',
        description:
          'Liste 4 aussergewöhnliche und lustige fiktive Ereignisse',
        parameters: z.object({
          events: z.array(
            z.object({
              date: z
                .string()
                .describe('Das Datum des Ereignisses, in ISO-8601 format'),
              headline: z.string().describe('Die Überschrift des Ereignisses'),
              description: z.string().describe('Eine kurze Beschreibung des Ereignisses'),
            }),
          ),
        }),
      }
    ],
    temperature: 0,
  });

  completion.onTextContent((content: string, isFinal: boolean) => {
  console.log(content);
  const elements = []; // This will hold both strings and React components
  let lastIndex = 0; // Tracks the last index after each processed segment
  let inCodeBlock = false; // Flag to track if we are currently in a code block
  let codeBlockStartIndex = 0; // To remember where the current code block started

  // Updated regex to find code block starts and ends
  const startRegex = /(```|´´´)(\w+)?\s*/g;
  let match;

  while ((match = startRegex.exec(content)) !== null) {
    if (!inCodeBlock) {
      // We found the start of a code block
      inCodeBlock = true;
      codeBlockStartIndex = match.index + match[0].length; // Adjust start index to exclude the delimiter and optional language identifier
      const textBeforeCode = content.substring(lastIndex, match.index);
      if (textBeforeCode) elements.push(textBeforeCode);
      lastIndex = startRegex.lastIndex; // Update lastIndex to the end of the current match
    } else {
      // We found the end of a code block
      inCodeBlock = false;
      const codeBlockContent = content.substring(codeBlockStartIndex, match.index);
      elements.push(<CodeBlock code={codeBlockContent.trim()} />);
      lastIndex = startRegex.lastIndex; // Update lastIndex to the end of the current match
    }
  }

  if (inCodeBlock) {
    // If we're still in a code block and there's no closing ```, consider everything till now as code
    const ongoingCodeBlockContent = content.substring(codeBlockStartIndex);
    elements.push(<CodeBlock code={ongoingCodeBlockContent.trim()} />);
  } else if (lastIndex < content.length) {
    // Add any remaining text after the last code block or if no code blocks are present
    const remainingText = content.substring(lastIndex);
    if (remainingText) elements.push(remainingText);
  }

  // Now `elements` contains a mix of strings and React components
  // Update your reply to use this mixed content
  if (elements.length > 0) {
    reply.update(<BotMessage>{elements}</BotMessage>);
  } else {
    // If there are no elements (which should be rare), just show the content as is
    reply.update(<BotMessage>{content}</BotMessage>);
  }

  if (isFinal) {
    reply.done();
    aiState.done([...aiState.get(), { role: 'assistant', content: content }]);
  }
});


  //
  // completion.onTextContent((content: string, isFinal: boolean) => {
  //
  //   const segments = content.split("```");
  //   <CodeBlock />
  //
  //   reply.update(<BotMessage>{content}</BotMessage>);
  //   if (isFinal) {
  //     reply.done();
  //     aiState.done([...aiState.get(), { role: 'assistant', content }]);
  //   }
  // });

  completion.onFunctionCall('get_events', async ({ events }) => {
    reply.update(
      <BotCard>
        <EventsSkeleton />
      </BotCard>,
    );

    console.log(events);
    await sleep(100);

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

  completion.onFunctionCall('get_prices', async ({ coins }) => {
    reply.update(
      <BotCard>
        <EventsSkeleton />
      </BotCard>,
    );

    console.log(coins);


    await sleep(500);

    reply.done(
      <BotCard>
        <Coins coins={coins} />
      </BotCard>,
    );

    aiState.done([
      ...aiState.get(),
      {
        role: 'function',
        name: 'get_prices',
        content: JSON.stringify(coins),
      },
    ]);
  });


  return {
    id: Date.now(),
    display: reply.value,
  };
}

// Define necessary types and create the AI.

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
