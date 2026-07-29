import { Redirect, Route, Switch } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { RoomPage } from './pages/RoomPage';

export default function App() {
  return (
    <Switch>
      <Route exact path="/" component={LandingPage} />
      <Route path="/room/:roomId" component={RoomPage} />
      <Redirect to="/" />
    </Switch>
  );
}
