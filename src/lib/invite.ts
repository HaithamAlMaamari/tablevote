import type { InviteSnapshot } from '@shared/types';

const CONTEXT = 'Add your private preferences so TableVote can find one shared recommendation. No account needed.';

export function inviteHeading(invite: InviteSnapshot): string {
  if (!invite.joinable) {
    return invite.hostNickname
      ? `${invite.hostNickname}'s table for ${invite.areaLabel} is closed.`
      : `This table for ${invite.areaLabel} is closed.`;
  }
  return invite.hostNickname
    ? `${invite.hostNickname} is choosing where the group should eat for ${invite.areaLabel}.`
    : `Help choose where the group should eat for ${invite.areaLabel}.`;
}

export function inviteMessage(invite: InviteSnapshot): string {
  return invite.joinable
    ? `${inviteHeading(invite)}\n${CONTEXT}`
    : `${inviteHeading(invite)}\nVoting has already closed for this table.`;
}

export const inviteContext = CONTEXT;
