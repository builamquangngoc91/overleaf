import { expressify } from '@overleaf/promise-utils'
import ChatApiHandler from './ChatApiHandler.mjs'
import ChatManager from './ChatManager.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'
import DocumentUpdaterHandler from '../DocumentUpdater/DocumentUpdaterHandler.mjs'

// Comment threads for the review panel. These endpoints bridge the review-panel
// frontend to the chat microservice (thread messages / resolve state) and to
// document-updater (comment ranges). They were historically part of a premium
// module; this controller re-implements the open pieces so the review panel
// works in the Community Edition. See Features/Chat/ChatController.mjs for the
// sibling global-chat controller.

async function getThreads(req, res) {
  const { project_id: projectId } = req.params
  const threads = await ChatApiHandler.promises.getThreads(projectId)
  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function sendComment(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  const comment = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    userId,
    content
  )

  const user = await UserInfoManager.promises.getPersonalInfo(comment.user_id)
  comment.user = UserInfoController.formatPersonalInfo(user)
  EditorRealTimeController.emitToRoom(
    projectId,
    'new-comment',
    threadId,
    comment
  )
  res.sendStatus(204)
}

async function resolveThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.resolveThread(projectId, threadId, userId)

  const user = await UserInfoManager.promises.getPersonalInfo(userId)
  EditorRealTimeController.emitToRoom(
    projectId,
    'resolve-thread',
    threadId,
    UserInfoController.formatPersonalInfo(user)
  )
  res.sendStatus(204)
}

async function reopenThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params

  await ChatApiHandler.promises.reopenThread(projectId, threadId)

  EditorRealTimeController.emitToRoom(projectId, 'reopen-thread', threadId)
  res.sendStatus(204)
}

async function deleteThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  await DocumentUpdaterHandler.promises.deleteThread(
    projectId,
    docId,
    threadId,
    userId
  )
  await ChatApiHandler.promises.deleteThread(projectId, threadId)

  EditorRealTimeController.emitToRoom(projectId, 'delete-thread', threadId)
  res.sendStatus(204)
}

async function editMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId,
    content
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'edit-message',
    threadId,
    messageId,
    content
  )
  res.sendStatus(204)
}

async function deleteMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params

  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)

  EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

async function deleteOwnMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.deleteUserMessage(
    projectId,
    threadId,
    userId,
    messageId
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

export default {
  getThreads: expressify(getThreads),
  sendComment: expressify(sendComment),
  resolveThread: expressify(resolveThread),
  reopenThread: expressify(reopenThread),
  deleteThread: expressify(deleteThread),
  editMessage: expressify(editMessage),
  deleteMessage: expressify(deleteMessage),
  deleteOwnMessage: expressify(deleteOwnMessage),
}
