import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maxZoneNameLength, type CameraZone, type ZoneEntryRule, type ZoneEntryRuleInput } from '@sensewell/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cameraApi, cameraZoneQuery, zoneEntryRuleQuery } from './camera-api';

export function ZoneEntryRules({ id, tenantId }: { id: string; tenantId: string }) {
  const client = useQueryClient();
  const zones = useQuery(cameraZoneQuery(id, tenantId));
  const ruleQuery = zoneEntryRuleQuery(id, tenantId);
  const rules = useQuery(ruleQuery);
  const [editing, setEditing] = useState<ZoneEntryRule>();
  const [removing, setRemoving] = useState<string>();
  const [message, setMessage] = useState('');
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ruleQuery.queryKey });
  const toggle = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      cameraApi.setRuleEnabled(id, ruleId, enabled),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (rule: ZoneEntryRule) => cameraApi.removeRule(id, rule.id),
    onSuccess: async (_, rule) => {
      await refresh();
      setRemoving(undefined);
      setMessage(`Removed ${rule.name}.`);
      heading.current?.focus();
    },
  });
  useEffect(() => {
    if (removing) cancelRemove.current?.focus();
  }, [removing]);

  function cancelEdit() {
    setEditing(undefined);
    actionButton.current?.focus();
  }

  return (
    <Card className="gap-4 px-5 sm:px-6">
      <h3 className="text-lg font-semibold" tabIndex={-1} ref={heading}>Person zone rules</h3>
      {zones.isPending && <p role="status">Loading zones…</p>}
      {zones.isError && <p className="error" role="alert">{zones.error.message}</p>}
      {zones.data?.length === 0 && <p className="text-sm text-slate-600">Save a zone to create a rule.</p>}
      {!!zones.data?.length && <RuleForm key={editing?.id ?? 'create'} id={id} zones={zones.data} rule={editing}
        onCancel={cancelEdit} onSaved={async (rule) => {
          await refresh();
          setMessage(`Saved ${rule.name}.`);
          if (editing) cancelEdit();
        }} />}
      {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
      {rules.isPending && <p role="status">Loading rules…</p>}
      {rules.isError && <p className="error" role="alert">{rules.error.message}</p>}
      {toggle.isError && <p className="error" role="alert">{toggle.error.message}</p>}
      {!!rules.data?.length && <ul className="divide-y border-t">
        {rules.data.map((rule) => <li key={rule.id} className="grid gap-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 wrap-anywhere">
              <p className="font-medium">{rule.name}</p>
              <p className="text-sm text-slate-600">
                {zones.data?.find((zone) => zone.id === rule.zoneId)?.name ?? 'Saved zone'} · {Math.round(rule.minimumConfidence * 100)}% minimum · {rule.enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={toggle.isPending || remove.isPending}
                aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.name}`}
                onClick={() => toggle.mutate({ ruleId: rule.id, enabled: !rule.enabled })}>
                {rule.enabled ? 'Disable rule' : 'Enable rule'}
              </Button>
              <Button type="button" variant="outline" aria-label={`Edit rule ${rule.name}`}
                onClick={(event) => {
                  actionButton.current = event.currentTarget;
                  setEditing(rule);
                  setMessage('');
                }}>Edit</Button>
              <Button type="button" variant="outline" aria-label={`Remove rule ${rule.name}`}
                disabled={remove.isPending} onClick={() => {
                  remove.reset();
                  setRemoving(rule.id);
                  setMessage('');
                }}>Remove</Button>
            </div>
          </div>
          {removing === rule.id && <div className="grid gap-2 rounded-md border bg-slate-50 p-3" role="group"
            aria-label={`Remove ${rule.name}?`}>
            <p className="text-sm wrap-anywhere">Remove {rule.name}? Its past events will stay in history.</p>
            {remove.isError && <p className="error" role="alert">{remove.error.message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button ref={cancelRemove} type="button" variant="outline" disabled={remove.isPending}
                onClick={() => {
                  setRemoving(undefined);
                  heading.current?.focus();
                }}>Cancel removal</Button>
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(rule)}>
                Remove rule
              </Button>
            </div>
          </div>}
        </li>)}
      </ul>}
    </Card>
  );
}

function RuleForm({ id, zones, rule, onSaved, onCancel }: {
  id: string;
  zones: CameraZone[];
  rule?: ZoneEntryRule;
  onSaved: (rule: ZoneEntryRule) => Promise<void>;
  onCancel: () => void;
}) {
  const prefix = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [zoneId, setZoneId] = useState(rule?.zoneId ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [confidence, setConfidence] = useState(rule ? String(rule.minimumConfidence * 100) : '50');
  const selectedZone = zones.find((zone) => zone.id === zoneId) ?? zones[0];
  const save = useMutation({
    mutationFn: (input: ZoneEntryRuleInput) => rule ? cameraApi.updateRule(id, rule.id, input) : cameraApi.addRule(id, input),
    onSuccess: async (saved) => {
      if (!rule) setName('');
      await onSaved(saved);
    },
  });
  useEffect(() => {
    if (rule) nameInput.current?.focus();
  }, [rule]);

  return selectedZone && (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      save.mutate({ zoneId: selectedZone.id, name, minimumConfidence: Number(confidence) / 100 });
    }}>
      <div className="field min-w-36 flex-1">
        <Label htmlFor={`${prefix}-zone`}>Saved zone</Label>
        <select id={`${prefix}-zone`} className="h-9 rounded-md border border-input bg-white px-2 text-sm"
          value={selectedZone.id} onChange={(event) => setZoneId(event.target.value)}>
          {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </select>
      </div>
      <div className="field min-w-36 flex-1">
        <Label htmlFor={`${prefix}-name`}>Rule name</Label>
        <Input ref={nameInput} id={`${prefix}-name`} value={name} maxLength={maxZoneNameLength} required
          onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <Label htmlFor={`${prefix}-confidence`}>Minimum confidence (%)</Label>
        <Input id={`${prefix}-confidence`} type="number" min={0} max={100} step="any" value={confidence} required
          onChange={(event) => setConfidence(event.target.value)} />
      </div>
      <Button type="submit" disabled={save.isPending}>{rule ? 'Save changes' : 'Create rule'}</Button>
      {rule && <Button type="button" variant="outline" disabled={save.isPending} onClick={onCancel}>Cancel edit</Button>}
      {save.isError && <p className="error w-full" role="alert">{save.error.message}</p>}
    </form>
  );
}
