import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from './schemas/session.schema';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] || '';
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    if (!token) throw new UnauthorizedException('Token manquant');

    const { userId, sessionId } = this.authService.verifyToken(token);
    const session = await this.sessionModel.findOne({ _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId), isActive: true });
    if (!session) throw new UnauthorizedException('Session invalide');

    req.user = { userId, sessionId };
    return true;
  }
}


