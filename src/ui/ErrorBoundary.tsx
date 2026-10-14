import { Component, ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { captureException } from '../services/crash';

type State = { hasError: boolean };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    captureException(error, { where: 'ErrorBoundary' });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 12,
          backgroundColor: '#f5f1e8',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#352c21' }}>Algo salio mal</Text>
        <Text style={{ fontSize: 14, color: '#6b5f4f', textAlign: 'center' }}>
          Ya registramos el error. Tus libros y subrayados estan a salvo.
        </Text>
        <TouchableOpacity
          onPress={() => this.setState({ hasError: false })}
          style={{ backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
