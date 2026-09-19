import { useCallback, useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { readJson, writeJson } from './storage';
import { CONTACT_NAME_RE, type Contact, type SavedBatch } from './contactsCore';
import type { BatchItem } from '@/utils/intentParser';

export * from './contactsCore';

const CONTACTS_KEY = 'vlora-contacts';
const BATCHES_KEY = 'vlora-saved-batches';

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>(() =>
    readJson<Contact[]>(CONTACTS_KEY, []).filter((c) => isAddress(c.address) && CONTACT_NAME_RE.test(c.name)),
  );

  useEffect(() => writeJson(CONTACTS_KEY, contacts), [contacts]);

  // Adding an existing name updates its address
  const saveContact = useCallback((name: string, address: `0x${string}`) => {
    setContacts((prev) => [
      ...prev.filter((c) => c.name.toLowerCase() !== name.toLowerCase()),
      { name, address },
    ]);
  }, []);

  const removeContact = useCallback((name: string) => {
    setContacts((prev) => prev.filter((c) => c.name.toLowerCase() !== name.toLowerCase()));
  }, []);

  return { contacts, saveContact, removeContact };
}

export function useSavedBatches() {
  const [batches, setBatches] = useState<SavedBatch[]>(() => readJson<SavedBatch[]>(BATCHES_KEY, []));

  useEffect(() => writeJson(BATCHES_KEY, batches), [batches]);

  const saveBatch = useCallback((name: string, items: BatchItem[]) => {
    setBatches((prev) => [...prev.filter((b) => b.name.toLowerCase() !== name.toLowerCase()), { name, items }]);
  }, []);

  const removeBatch = useCallback((name: string) => {
    setBatches((prev) => prev.filter((b) => b.name !== name));
  }, []);

  return { batches, saveBatch, removeBatch };
}

