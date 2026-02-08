import { createRouter, createWebHistory } from 'vue-router';

import SessionsPage from '../pages/SessionsPage.vue';
import StatusPage from '../pages/StatusPage.vue';
import ReportsPage from '../pages/ReportsPage.vue';
import FeedbackPage from '../pages/FeedbackPage.vue';
import SkillsPage from '../pages/SkillsPage.vue';
import NotesPage from '../pages/NotesPage.vue';

const routes = [
  { path: '/', redirect: '/sessions' },
  { path: '/sessions', component: SessionsPage },
  { path: '/notes', component: NotesPage },
  { path: '/skills', component: SkillsPage },
  { path: '/status', component: StatusPage },
  { path: '/reports', component: ReportsPage },
  { path: '/feedback', component: FeedbackPage }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
