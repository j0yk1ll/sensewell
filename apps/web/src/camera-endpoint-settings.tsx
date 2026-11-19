import { maxCameraStreamUrlLength } from '@sensewell/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cameraEndpointApi } from './camera-api';

export function CameraEndpointSettings({ operatorId }: { operatorId: string }) {
  const [endpoint, setEndpoint] = useState('');
  const queryClient = useQueryClient();
  const queryKey = ['camera-endpoints', operatorId];
  const settings = useQuery({
    queryKey,
    queryFn: ({ signal }) => cameraEndpointApi.settings(signal),
    retry: false,
  });
  const approve = useMutation({
    mutationFn: cameraEndpointApi.approve,
    onSuccess: async () => {
      setEndpoint('');
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: cameraEndpointApi.revoke,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const pending = approve.isPending || revoke.isPending;
  const error = approve.error ?? revoke.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    revoke.reset();
    approve.mutate(endpoint.trim());
  }

  return (
    <Card className="gap-0 py-0">
      <details>
        <summary className="cursor-pointer rounded-md px-5 py-4 font-semibold">Camera endpoints</summary>
        <div className="grid gap-3 border-t border-slate-200 p-5">
          {settings.isPending && <p className="text-sm text-slate-600" role="status">Loading endpoint settings…</p>}
          {settings.isError && <>
            <p className="error" role="alert">{settings.error.message}</p>
            <Button type="button" variant="outline" className="justify-self-start"
              onClick={() => void settings.refetch()}>Retry</Button>
          </>}
          {settings.data && !settings.data.canManage && (
            <p className="text-sm text-slate-600">Ask a camera endpoint administrator to approve the host and port of your stream URL.</p>
          )}
          {settings.data?.canManage && <>
            <form className="grid gap-3" onSubmit={submit}>
              <div className="field">
                <Label htmlFor="camera-endpoint">Host, IP address, or RTSP URL</Label>
                <Input id="camera-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="rtsp://rtsp.143b.ch:554/stream" required maxLength={maxCameraStreamUrlLength} disabled={pending} aria-describedby="camera-endpoint-port" />
                <p id="camera-endpoint-port" className="text-xs text-slate-600">Approvals are saved by host and port. The default RTSP port is 554.</p>
              </div>
              <Button type="submit" disabled={pending || !endpoint.trim()}>
                {approve.isPending ? 'Approving…' : 'Approve endpoint'}
              </Button>
            </form>
            {error && <p className="error" role="alert">{error.message}</p>}
            {settings.data.endpoints.length
              ? <>
                <p className="text-xs text-slate-600">Revoking an endpoint stops capture from that host and port.</p>
                <ul className="grid gap-2" aria-label="Approved camera endpoints">
                  {settings.data.endpoints.map((approved) => (
                    <li key={approved} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                      <span className="min-w-0 wrap-anywhere">{approved}</span>
                      <Button type="button" size="sm" variant="outline" disabled={pending}
                        aria-label={`Revoke ${approved}`}
                        onClick={() => { approve.reset(); revoke.mutate(approved); }}>
                        {revoke.isPending && revoke.variables === approved ? 'Revoking…' : 'Revoke'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
              : <p className="text-sm text-slate-600">No approved endpoints.</p>}
          </>}
        </div>
      </details>
    </Card>
  );
}
