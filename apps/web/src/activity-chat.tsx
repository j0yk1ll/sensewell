import { useMutation } from '@tanstack/react-query';
import { maxActivityQuestionLength, type ActivityChatSource, type activityChatResponse } from '@sensewell/contracts';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatClipTime } from '@/lib/utils';
import { cameraApi } from './camera-api';

type ChatQuestion = { question: string; passId: string };
type Exchange = ChatQuestion & { result: ReturnType<typeof activityChatResponse.parse> };
const time = (ms: number) => formatClipTime(ms, true);

export function ActivityChat({ cameraId, passId }: { cameraId: string; passId: string }) {
  const questionId = useId();
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const chat = useMutation({
    mutationFn: (asked: ChatQuestion) => cameraApi.activityChat(cameraId, {
      ...asked,
      previousQuestions: exchanges.filter((exchange) => exchange.passId === asked.passId)
        .slice(-3).map((exchange) => exchange.question),
    }),
    onSuccess(result, asked) {
      setExchanges((current) => [...current, { ...asked, result }]);
      setQuestion('');
    },
  });

  return (
    <section aria-labelledby={`${questionId}-heading`} className="grid gap-4 border-t pt-4">
      <h4 id={`${questionId}-heading`} className="font-semibold">Investigate footage</h4>
      <div aria-live="polite" className="grid gap-4">
        {exchanges.map(({ question: asked, result }, index) => (
          <article key={index} className="grid gap-3 rounded-md border bg-slate-50 p-4 text-sm wrap-anywhere">
            <p className="whitespace-pre-wrap font-medium">{asked}</p>
            <p className="whitespace-pre-wrap">{result.answer}</p>
            {result.sources.map((source, sourceIndex) => <Evidence key={sourceIndex} source={source} />)}
          </article>
        ))}
        {chat.isPending && <p role="status" className="text-sm text-slate-600">Checking recorded activity…</p>}
      </div>
      <form className="grid gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!chat.isPending && question.trim()) chat.mutate({ question: question.trim(), passId });
      }}>
        <Label htmlFor={questionId}>Ask about recorded activity</Label>
        <textarea id={questionId} value={question} onChange={(event) => setQuestion(event.target.value)}
          rows={3} maxLength={maxActivityQuestionLength} required disabled={chat.isPending}
          placeholder="How many people entered the rack-side zone in the first 30 seconds at 50% confidence? Include possible crossings."
          className="border-input bg-background focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50" />
        {chat.error && <p role="alert" className="error">{chat.error.message}</p>}
        <Button type="submit" className="justify-self-start" disabled={chat.isPending || !question.trim()}>
          Ask
        </Button>
      </form>
    </section>
  );
}

function Evidence({ source }: { source: ActivityChatSource }) {
  const { cameraId, cameraName, passId, passNumber, passStartedAt, fromMs, toMs, coverage, incomplete, active, timestamps } = source;
  return (
    <div className="grid gap-1 border-t pt-2">
      <p className="font-medium" title={passId}>{cameraName} · Pass {passNumber} · {new Date(passStartedAt).toLocaleString()}</p>
      <p className="text-slate-700">
        Requested {time(fromMs)} to {time(toMs)}.{' '}
        {coverage ? `Analyzed from ${time(coverage.firstMs)} through ${time(coverage.lastMs)}.` : 'No analyzed observations.'}
        {active && ' Replay is in progress.'}
        {incomplete && ' Coverage is incomplete for this question.'}
      </p>
      {!!timestamps.length && <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Supporting source timestamps">
        {timestamps.map((ms) => <li key={ms}>
          <a className="font-medium text-sky-800 underline underline-offset-2" target="_blank" rel="noreferrer"
            aria-label={`Open ${cameraName} footage at ${time(ms)} in a new tab`} href={`${cameraApi.media(cameraId)}#t=${ms / 1000}`}>
            {time(ms)}
          </a>
        </li>)}
      </ul>}
    </div>
  );
}
