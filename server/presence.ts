import type { Server, Socket } from 'socket.io';
import { projectSession } from '../shared/projections';
import type { Participant, Session } from '../shared/types';
import type { OperationEffect } from './operations';
import type { SessionStore } from './store';

export interface SocketAttachment {
  sessionId: string;
  participantId: string;
}

export class SessionPresence {
  private readonly socketsByParticipant = new Map<string, Map<string, Set<string>>>();

  constructor(
    private readonly io: Server,
    private readonly store: SessionStore,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  onlineParticipantIds(sessionId: string): ReadonlySet<string> {
    return new Set(
      [...(this.socketsByParticipant.get(sessionId)?.entries() ?? [])]
        .filter(([, sockets]) => sockets.size > 0)
        .map(([participantId]) => participantId),
    );
  }

  apply(effect: OperationEffect, socket?: Socket, attachment?: SocketAttachment | null): SocketAttachment | null {
    if (effect.kind === 'attach') {
      if (!socket) return attachment ?? null;
      return this.attach(socket, effect.session, effect.participant, attachment ?? null);
    }
    if (effect.kind === 'broadcast') this.broadcast(effect.sessionId);
    if (effect.kind === 'evict') this.evict(effect.session, effect.participantId);
    if (effect.kind === 'revealed') this.io.to(effect.sessionId).emit('revealed', { at: this.clock() });
    if (effect.kind === 'rerun') this.io.to(effect.sessionId).emit('rerun', { at: this.clock() });
    if (effect.kind === 'ended') this.end(effect.sessionId);
    return attachment ?? null;
  }

  disconnect(socket: Socket, attachment: SocketAttachment | null): void {
    if (!attachment) return;
    this.mark(attachment.sessionId, attachment.participantId, socket.id, false);
    this.broadcast(attachment.sessionId);
  }

  expire(session: Session): void {
    this.socketsByParticipant.delete(session.id);
    this.io.to(session.id).emit('session-expired');
    this.io.in(session.id).socketsLeave(session.id);
  }

  private participantRoom(sessionId: string, participantId: string): string {
    return `${sessionId}:participant:${participantId}`;
  }

  private attach(
    socket: Socket,
    session: Session,
    participant: Participant,
    previous: SocketAttachment | null,
  ): SocketAttachment {
    if (previous) {
      this.mark(previous.sessionId, previous.participantId, socket.id, false);
      socket.leave(previous.sessionId);
      socket.leave(this.participantRoom(previous.sessionId, previous.participantId));
    }
    socket.join(session.id);
    socket.join(this.participantRoom(session.id, participant.id));
    this.mark(session.id, participant.id, socket.id, true);
    if (previous && previous.sessionId !== session.id) this.broadcast(previous.sessionId);
    return { sessionId: session.id, participantId: participant.id };
  }

  private mark(sessionId: string, participantId: string, socketId: string, online: boolean): void {
    let participants = this.socketsByParticipant.get(sessionId);
    if (online && !participants) {
      participants = new Map();
      this.socketsByParticipant.set(sessionId, participants);
    }
    if (!participants) return;
    let sockets = participants.get(participantId);
    if (online && !sockets) {
      sockets = new Set();
      participants.set(participantId, sockets);
    }
    if (online) sockets!.add(socketId);
    else sockets?.delete(socketId);
    if (sockets?.size === 0) participants.delete(participantId);
    if (participants.size === 0) this.socketsByParticipant.delete(sessionId);
  }

  private broadcast(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) return;
    const online = this.onlineParticipantIds(session.id);
    for (const participant of session.participants) {
      this.io
        .to(this.participantRoom(session.id, participant.id))
        .emit('state', projectSession(session, participant, online));
    }
  }

  private evict(session: Session, participantId: string): void {
    const room = this.participantRoom(session.id, participantId);
    this.socketsByParticipant.get(session.id)?.delete(participantId);
    this.io.to(room).emit('removed');
    this.io.in(room).socketsLeave(session.id);
    this.io.in(room).socketsLeave(room);
  }

  private end(sessionId: string): void {
    this.socketsByParticipant.delete(sessionId);
    this.io.to(sessionId).emit('session-ended');
    this.io.in(sessionId).socketsLeave(sessionId);
  }
}
