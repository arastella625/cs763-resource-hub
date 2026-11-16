// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — routes for help desk tickets and the allocation command (/api/v1/assets/tickets)
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Router } from 'express';
import { allocateTicket } from '../services/allocationService.js';
import * as tickets from '../services/ticketService.js';
import {
  allocateTicketSchema,
  createTicketSchema,
  ticketQuerySchema,
  updateTicketSchema,
  uuidParam,
} from '../validation/schemas.js';

export const ticketsRouter = Router();

const ticketId = uuidParam('ticket_id');

ticketsRouter.post('/', async (req, res) => {
  res.status(201).json(await tickets.createTicket(createTicketSchema.parse(req.body)));
});

ticketsRouter.get('/', async (req, res) => {
  res.json(await tickets.listTickets(ticketQuerySchema.parse(req.query)));
});

ticketsRouter.get('/:ticket_id', async (req, res) => {
  const { ticket_id } = ticketId.parse(req.params);
  res.json(await tickets.getTicket(ticket_id));
});

ticketsRouter.put('/:ticket_id', async (req, res) => {
  const { ticket_id } = ticketId.parse(req.params);
  res.json(await tickets.updateTicket(ticket_id, updateTicketSchema.parse(req.body)));
});

ticketsRouter.delete('/:ticket_id', async (req, res) => {
  const { ticket_id } = ticketId.parse(req.params);
  await tickets.deleteTicket(ticket_id);
  res.status(204).end();
});

ticketsRouter.post('/:ticket_id/allocate', async (req, res) => {
  const { ticket_id } = ticketId.parse(req.params);
  res.json(await allocateTicket(ticket_id, allocateTicketSchema.parse(req.body)));
});
