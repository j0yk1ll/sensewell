import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cameraApi } from './camera-api';

export function CameraRemoval({ id, description, onRemoved }: {
  id: string;
  description: string;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const remove = useMutation({ mutationFn: () => cameraApi.remove(id), onSuccess: onRemoved });

  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  return <>
    <Button ref={trigger} type="button" variant="outline" aria-expanded={confirming}
      aria-controls={confirming ? confirmationId : undefined} onClick={() => setConfirming(true)}>
      Remove camera
    </Button>
    {confirming && <div id={confirmationId} role="group" aria-label="Confirm camera removal"
      className="grid basis-full gap-3 rounded-md border bg-slate-50 p-3">
      <p>{description}</p>
      {remove.isError && <p className="error" role="alert">{remove.error.message}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? 'Removing camera…' : 'Confirm removal'}
        </Button>
        <Button ref={cancel} type="button" variant="outline" disabled={remove.isPending} onClick={() => {
          remove.reset();
          setConfirming(false);
          trigger.current?.focus();
        }}>Cancel</Button>
      </div>
    </div>}
  </>;
}
