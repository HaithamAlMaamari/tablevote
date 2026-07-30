import { describe, expect, it } from 'vitest';
import { inviteHeading, inviteMessage } from './invite';

const invite = {
  code: 'ABCDE', areaLabel: 'Qurum', expiresAt: 1, joinable: true,
};

describe('invite copy', () => {
  it('keeps the host anonymous unless public invite metadata includes consented copy', () => {
    expect(inviteHeading(invite)).toBe('Help choose where the group should eat for Qurum.');
    expect(inviteMessage(invite)).not.toMatch(/host|nickname/i);
  });

  it('uses the consented temporary host nickname context', () => {
    expect(inviteHeading({ ...invite, hostNickname: 'Sam' }))
      .toBe('Sam is choosing where the group should eat for Qurum.');
  });

  it('does not describe a locked table as an active choice', () => {
    expect(inviteMessage({ ...invite, joinable: false, hostNickname: 'Sam' }))
      .toBe("Sam's table for Qurum is closed.\nVoting has already closed for this table.");
  });
});
