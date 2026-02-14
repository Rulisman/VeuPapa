
import React, { useEffect, useRef } from 'react';
import { AppStatus } from '../types';

interface AudioVisualizerProps {
  status: AppStatus;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ status }) => {
  return (
    <div className="flex items-center justify-center h-48 w-full">
      <div className={`relative flex items-center justify-center`}>
        {status === AppStatus.LISTENING && (
          <>
            <div className="absolute w-32 h-32 bg-blue-400 rounded-full pulse"></div>
            <div className="absolute w-40 h-40 bg-blue-300 rounded-full pulse opacity-50" style={{ animationDelay: '0.5s' }}></div>
          </>
        )}
        
        <div className={`z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
          status === AppStatus.LISTENING ? 'bg-blue-600 scale-110' :
          status === AppStatus.PROCESSING ? 'bg-amber-500 animate-spin-slow' :
          status === AppStatus.SPEAKING ? 'bg-green-600' :
          'bg-slate-300'
        }`}>
          <i className={`fa-solid text-white text-3xl ${
            status === AppStatus.LISTENING ? 'fa-microphone' :
            status === AppStatus.PROCESSING ? 'fa-spinner' :
            status === AppStatus.SPEAKING ? 'fa-volume-high' :
            'fa-microphone-slash'
          }`}></i>
        </div>
      </div>
    </div>
  );
};
