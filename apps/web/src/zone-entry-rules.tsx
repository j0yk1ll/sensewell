import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maxZoneNameLength, type ZoneEntryRuleInput } from '@sensewell/contracts';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cameraApi, cameraZoneQuery, zoneEntryRuleQuery } from './camera-api';

export function ZoneEntryRules({ id, tenantId }: { id: string; tenantId: string }) {
  const prefix = useId();
  const client = useQueryClient();
  const zones = useQuery(cameraZoneQuery(id, tenantId));
  const ruleQuery = zoneEntryRuleQuery(id, tenantId);
  const rules = useQuery(ruleQuery);
  const [zoneId, setZoneId] = useState('');
  const [name, setName] = useState('');
  const [confidence, setConfidence] = useState('50');
  const selectedZone = zones.data?.find((zone) => zone.id === zoneId) ?? zones.data?.[0];
  const add = useMutation({
    mutationFn: (input: ZoneEntryRuleInput) => cameraApi.addRule(id, input),
    onSuccess: () => {
      setName('');
      return client.invalidateQueries({ queryKey: ruleQuery.queryKey });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      cameraApi.setRuleEnabled(id, ruleId, enabled),
    onSuccess: () => client.invalidateQueries({ queryKey: ruleQuery.queryKey }),
  });

  return (
    <Card className="gap-4 px-5 sm:px-6">
      <h3 className="text-lg font-semibold">Person zone-entry rules</h3>
      {zones.isPending && <p role="status">Loading zones…</p>}
      {zones.isError && <p className="error" role="alert">{zones.error.message}</p>}
      {zones.data?.length === 0 && <p className="text-sm text-slate-600">Save a zone to create a rule.</p>}
      {selectedZone && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        add.mutate({ zoneId: selectedZone.id, name, minimumConfidence: Number(confidence) / 100 });
      }}>
        <div className="field min-w-36 flex-1">
          <Label htmlFor={`${prefix}-zone`}>Saved zone</Label>
          <select id={`${prefix}-zone`} className="h-9 rounded-md border border-input bg-white px-2 text-sm"
            value={selectedZone.id} onChange={(event) => setZoneId(event.target.value)}>
            {zones.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </div>
        <div className="field min-w-36 flex-1">
          <Label htmlFor={`${prefix}-name`}>Rule name</Label>
          <Input id={`${prefix}-name`} value={name} maxLength={maxZoneNameLength} required
            onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <Label htmlFor={`${prefix}-confidence`}>Minimum confidence (%)</Label>
          <Input id={`${prefix}-confidence`} type="number" min={0} max={100} value={confidence} required
            onChange={(event) => setConfidence(event.target.value)} />
        </div>
        <Button type="submit" disabled={add.isPending}>Create rule</Button>
      </form>}
      {add.isError && <p className="error" role="alert">{add.error.message}</p>}
      {rules.isPending && <p role="status">Loading rules…</p>}
      {rules.isError && <p className="error" role="alert">{rules.error.message}</p>}
      {toggle.isError && <p className="error" role="alert">{toggle.error.message}</p>}
      {!!rules.data?.length && <ul className="divide-y border-t">
        {rules.data.map((rule) => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 wrap-anywhere">
            <p className="font-medium">{rule.name}</p>
            <p className="text-sm text-slate-600">
              {zones.data?.find((zone) => zone.id === rule.zoneId)?.name ?? 'Saved zone'} · {Math.round(rule.minimumConfidence * 100)}% minimum · {rule.enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
          <Button type="button" variant="outline" disabled={toggle.isPending}
            aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.name}`}
            onClick={() => toggle.mutate({ ruleId: rule.id, enabled: !rule.enabled })}>
            {rule.enabled ? 'Disable rule' : 'Enable rule'}
          </Button>
        </li>)}
      </ul>}
    </Card>
  );
}
