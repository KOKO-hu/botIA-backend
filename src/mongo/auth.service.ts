import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User, UserDocument } from './schemas/user.schema';
import { Session, SessionDocument } from './schemas/session.schema';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
  ) {}

  async register(email: string, password: string): Promise<{ userId: string }> {
    const startedAt = Date.now();
    this.logger.debug(`Register flow start email=${email?.toLowerCase()?.trim()}`);
    const existing = await this.userModel.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      this.logger.warn(`Register conflict email=${email?.toLowerCase()?.trim()}`);
      throw new ConflictException('Email déjà utilisé');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.userModel.create({ email: email.toLowerCase().trim(), passwordHash, isActive: true });
    this.logger.log(`Utilisateur créé: ${user._id} in ${Date.now() - startedAt}ms`);
    return { userId: user._id.toString() };
  }

  async login(email: string, password: string): Promise<{ userId: string; sessionId: string }> {
    const startedAt = Date.now();
    this.logger.debug(`Login flow start email=${email?.toLowerCase()?.trim()}`);
    const user = await this.userModel.findOne({ email: email.toLowerCase().trim(), isActive: true });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Identifiants invalides');

    // Une seule session active par utilisateur: réutiliser ou créer
    let session = await this.sessionModel.findOne({ userId: user._id });
    if (!session) {
      session = await this.sessionModel.create({ userId: user._id, isActive: true });
    } else if (!session.isActive) {
      session.isActive = true;
      await session.save();
    }

    this.logger.log(`Session active pour user=${user._id}, session=${session._id} in ${Date.now() - startedAt}ms`);
    return { userId: user._id.toString(), sessionId: session._id.toString() };
  }

  async logout(sessionId: string): Promise<void> {
    const id = new Types.ObjectId(sessionId);
    await this.sessionModel.updateOne({ _id: id }, { $set: { isActive: false } });
    this.logger.log(`Session désactivée: ${sessionId}`);
  }

  issueToken(userId: string, sessionId: string): string {
    const secret = process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    if (!secret) throw new UnauthorizedException('JWT secret non configuré');
    const token = jwt.sign({ userId, sessionId }, secret, { expiresIn });
    return token;
  }

  verifyToken(token: string): { userId: string; sessionId: string } {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('JWT secret non configuré');
    try {
      const payload = jwt.verify(token, secret) as any;
      return { userId: String(payload.userId), sessionId: String(payload.sessionId) };
    } catch (e) {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }

  // Vérifier un ID token Google côté serveur
  async verifyGoogleIdToken(idToken: string): Promise<{ email: string; googleId: string; name?: string; avatar?: string }>{
    const startedAt = Date.now();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new UnauthorizedException('GOOGLE_CLIENT_ID manquant');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email) throw new UnauthorizedException('ID token Google invalide');
    this.logger.debug(`Google token verified in ${Date.now() - startedAt}ms`);
    return {
      email: String(payload.email).toLowerCase(),
      googleId: String(payload.sub),
      name: payload.name,
      avatar: payload.picture,
    };
  }

  // Upsert Google user and ensure single active session
  async upsertGoogleUser(email: string, googleId: string, name?: string, avatar?: string): Promise<{ userId: string; sessionId: string }>{
    const startedAt = Date.now();
    const lower = (email || '').toLowerCase().trim();
    let user = await this.userModel.findOne({ $or: [{ googleId }, { email: lower }] });
    if (!user) {
      user = await this.userModel.create({ email: lower, googleId, name, avatar, isActive: true });
    } else {
      user.googleId = googleId;
      if (name) user.name = name;
      if (avatar) user.avatar = avatar;
      await user.save();
    }

    let session = await this.sessionModel.findOne({ userId: user._id });
    if (!session) {
      session = await this.sessionModel.create({ userId: user._id, isActive: true });
    } else if (!session.isActive) {
      session.isActive = true;
      await session.save();
    }
    this.logger.log(`Upserted Google user and session in ${Date.now() - startedAt}ms user=${user._id} session=${session._id}`);
    return { userId: user._id.toString(), sessionId: session._id.toString() };
  }
}


